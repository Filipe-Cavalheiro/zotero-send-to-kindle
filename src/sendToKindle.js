/* global Zotero, ChromeUtils */
const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");

const PREF_PREFIX = "extensions.sendtokindle.";
const MENU_ID = "send-to-kindle-item";
const FTL_FILE = "send-to-kindle.ftl";

SendToKindle = {
  id: null,
  version: null,
  rootURI: null,
  menuID: null,

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    Zotero.SendToKindle = this;
  },

  shutdown() {
    if (this.menuID) {
      Zotero.MenuManager.unregisterMenu(this.menuID);
      this.menuID = null;
    }
    delete Zotero.SendToKindle;
  },

  log(msg) {
    Zotero.debug("Send to Kindle: " + msg);
  },

  getPref(key) {
    return Zotero.Prefs.get(PREF_PREFIX + key, true);
  },

  setPref(key, value) {
    Zotero.Prefs.set(PREF_PREFIX + key, value, true);
  },

  addToWindow(window) {
    window.MozXULElement.insertFTLIfNeeded(FTL_FILE);
  },

  removeFromWindow(window) {
    window.document.querySelector(`[href="${FTL_FILE}"]`)?.remove();
  },

  registerMenu() {
    this.menuID = Zotero.MenuManager.registerMenu({
      menuID: MENU_ID,
      pluginID: this.id,
      target: "main/library/item",
      menus: [
        {
          menuType: "menuitem",
          l10nID: "send-to-kindle-menuitem",
          icon: this.rootURI + "content/icons/kindle.svg",
          onShowing: (event, context) => {
            context.setVisible(!!context.items?.some(item => this.getPDFAttachments(item).length));
          },
          onCommand: (event, context) => {
            this.sendItems(context.items, context.collectionTreeRows?.[0]).catch((e) => {
              Zotero.logError(e);
            });
          },
        },
      ],
    });
  },

  // --- Item / collection helpers ---

  getPDFAttachments(item) {
    if (item.isPDFAttachment()) {
      return [item];
    }
    if (!item.isRegularItem()) {
      return [];
    }
    return Zotero.Items.get(item.getAttachments()).filter(att => att.isPDFAttachment());
  },

  async getPDFForItem(item) {
    if (item.isPDFAttachment()) {
      return item;
    }
    let best = await item.getBestAttachment();
    if (best && best.isPDFAttachment()) {
      return best;
    }
    return this.getPDFAttachments(item)[0] || null;
  },

  getCollectionPath(collection) {
    let names = [];
    while (collection) {
      names.unshift(collection.name);
      collection = collection.parentID ? Zotero.Collections.get(collection.parentID) : null;
    }
    return names;
  },

  /**
   * Collection path segments for an item. Uses the collection selected in the
   * left pane; when a library root/search/unfiled view is selected, falls back
   * to the item's collection if it belongs to exactly one.
   */
  getTargetSegments(item, row) {
    if (row && row.isCollection()) {
      return this.getCollectionPath(row.ref);
    }
    let topItem = item.parentItem || item;
    let collectionIDs = topItem.getCollections();
    if (collectionIDs.length === 1) {
      return this.getCollectionPath(Zotero.Collections.get(collectionIDs[0]));
    }
    return [];
  },

  sanitize(name) {
    // Kindle user storage is FAT-formatted
    let clean = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().replace(/[. ]+$/, "");
    return clean || "_";
  },

  shellQuote(str) {
    return "'" + str.replace(/'/g, "'\\''") + "'";
  },

  // --- Host discovery ---

  async run(command, args) {
    let proc = await Subprocess.call({ command, arguments: args, stderr: "stdout" });
    let output = "";
    let chunk;
    while ((chunk = await proc.stdout.readString())) {
      output += chunk;
    }
    let { exitCode } = await proc.wait();
    return { exitCode, output };
  },

  async readARPTable() {
    let cat = await Subprocess.pathSearch("cat");
    let { output } = await this.run(cat, ["/proc/net/arp"]);
    return output.split("\n").slice(1)
      .map(line => line.trim().split(/\s+/))
      .filter(cols => cols.length >= 4 && cols[2] !== "0x0")
      .map(cols => ({ ip: cols[0], mac: cols[3].toLowerCase() }));
  },

  async lookupMAC(mac) {
    let entry = (await this.readARPTable()).find(e => e.mac === mac);
    return entry ? entry.ip : null;
  },

  /**
   * Touch every address in the known /24 subnets so the kernel ARP table
   * learns the Kindle's MAC address.
   */
  async sweepSubnets() {
    let prefixes = new Set();
    let lastIP = this.getPref("lastIP");
    for (let ip of [lastIP, ...(await this.readARPTable()).map(e => e.ip)]) {
      let m = ip && ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
      if (m) {
        prefixes.add(m[1]);
      }
    }
    let win = Zotero.getMainWindow();
    let port = this.getPref("port");
    let probes = [];
    for (let prefix of prefixes) {
      for (let i = 1; i < 255; i++) {
        probes.push(
          win.fetch(`http://${prefix}.${i}:${port}/`, { signal: win.AbortSignal.timeout(1500) })
            .catch(() => {})
        );
      }
    }
    await Promise.all(probes);
  },

  async resolveHost() {
    let manual = this.getPref("host");
    if (manual) {
      return manual;
    }
    let mac = this.getPref("mac").trim().toLowerCase();
    let ip = await this.lookupMAC(mac);
    if (!ip) {
      this.log(`MAC ${mac} not in ARP table, sweeping subnet`);
      await this.sweepSubnets();
      ip = await this.lookupMAC(mac);
    }
    if (!ip) {
      throw new Error(
        `Kindle (${mac}) not found on the network. Make sure it is awake, `
        + "Wi-Fi is on and the KOReader SSH server is running."
      );
    }
    this.setPref("lastIP", ip);
    return ip;
  },

  // --- SSH ---

  sshOptions() {
    let opts = [
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
      "-o", "StrictHostKeyChecking=accept-new",
    ];
    let identity = this.getPref("identityFile");
    if (identity) {
      opts.push("-i", identity);
    }
    return opts;
  },

  async ssh(host, remoteCommand) {
    let ssh = await Subprocess.pathSearch("ssh");
    let args = ["-p", String(this.getPref("port")), ...this.sshOptions(),
      `${this.getPref("user")}@${host}`, remoteCommand];
    let result = await this.run(ssh, args);
    if (result.exitCode !== 0) {
      throw new Error(`ssh failed (${result.exitCode}): ${result.output.trim()}`);
    }
    return result.output;
  },

  async scp(host, localPath, remotePath) {
    let scp = await Subprocess.pathSearch("scp");
    // -O: legacy SCP protocol, KOReader's dropbear has no SFTP subsystem
    let args = ["-O", "-P", String(this.getPref("port")), ...this.sshOptions(),
      localPath, `${this.getPref("user")}@${host}:${this.shellQuote(remotePath)}`];
    let result = await this.run(scp, args);
    if (result.exitCode !== 0) {
      throw new Error(`scp failed (${result.exitCode}): ${result.output.trim()}`);
    }
  },

  // --- Actions ---

  async sendItems(items, row) {
    let progress = new Zotero.ProgressWindow({ closeOnClick: true });
    progress.changeHeadline("Send to Kindle");
    progress.show();
    let line = new progress.ItemProgress(this.rootURI + "content/icons/kindle.svg", "Looking for Kindle…");

    try {
      let basePath = this.getPref("basePath").replace(/\/+$/, "");
      let jobs = [];
      let seen = new Set();
      for (let item of items) {
        let att = await this.getPDFForItem(item);
        if (!att || seen.has(att.id)) {
          continue;
        }
        seen.add(att.id);
        let localPath = await att.getFilePathAsync();
        if (!localPath) {
          this.log(`Skipping ${att.key}: file not available locally`);
          continue;
        }
        let segments = this.getTargetSegments(item, row).map(s => this.sanitize(s));
        let remoteDir = [basePath, ...segments].join("/");
        let fileName = this.sanitize(PathUtils.filename(localPath));
        jobs.push({ localPath, remoteDir, remotePath: remoteDir + "/" + fileName, fileName });
      }
      if (!jobs.length) {
        throw new Error("No local PDF files found in the selection.");
      }

      let host = await this.resolveHost();
      let dirs = [...new Set(jobs.map(j => j.remoteDir))];
      await this.ssh(host, "mkdir -p " + dirs.map(d => this.shellQuote(d)).join(" "));

      for (let [i, job] of jobs.entries()) {
        line.setText(`Sending ${i + 1}/${jobs.length}: ${job.fileName}`);
        line.setProgress(Math.round((i / jobs.length) * 100));
        await this.scp(host, job.localPath, job.remotePath);
      }

      line.setProgress(100);
      let where = dirs.length === 1 ? dirs[0] : `${dirs.length} folders`;
      line.setText(`Sent ${jobs.length} PDF${jobs.length > 1 ? "s" : ""} to ${where}`);
      progress.startCloseTimer(4000);
    }
    catch (e) {
      line.setError();
      line.setText(e.message);
      progress.startCloseTimer(10000);
      throw e;
    }
  },

  async testConnection() {
    let host = await this.resolveHost();
    let output = await this.ssh(host, "echo ok");
    if (output.trim() !== "ok") {
      throw new Error(`Unexpected response: ${output}`);
    }
    return host;
  },
};
