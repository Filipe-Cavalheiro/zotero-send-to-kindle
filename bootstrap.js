/* global Zotero, Services */
var SendToKindle;

function install() {}

async function startup({ id, version, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "src/sendToKindle.js");
  SendToKindle.init({ id, version, rootURI });

  Zotero.PreferencePanes.register({
    pluginID: id,
    src: rootURI + "content/preferences.xhtml",
    scripts: [rootURI + "content/preferences.js"],
    label: "Send to Kindle",
    image: rootURI + "content/icons/kindle.svg",
  });

  SendToKindle.registerMenu();
  for (let win of Zotero.getMainWindows()) {
    SendToKindle.addToWindow(win);
  }
}

function onMainWindowLoad({ window }) {
  SendToKindle.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  SendToKindle.removeFromWindow(window);
}

function shutdown() {
  for (let win of Zotero.getMainWindows()) {
    SendToKindle.removeFromWindow(win);
  }
  SendToKindle.shutdown();
  SendToKindle = undefined;
}

function uninstall() {}
