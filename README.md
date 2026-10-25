# Send to Kindle (KOReader) for Zotero

A Zotero 8–10 plugin that adds **Send PDF to Kindle** to the item context menu.
It copies the selected item's PDF to a jailbroken Kindle running
[KOReader](https://koreader.rocks) over SSH, mirroring your Zotero collection
structure:

| Selected in Zotero        | Lands on the Kindle at                     |
|---------------------------|--------------------------------------------|
| `My Library/MCP`          | `/mnt/us/documents/Papers/MCP/`            |
| `My Library/ML/Diffusion` | `/mnt/us/documents/Papers/ML/Diffusion/`   |
| `My Library` (root)       | the item's collection if it has exactly one, otherwise `Papers/` |

Multiple items can be sent at once.

## How it works

1. Finds the Kindle's IP from its **MAC address** by reading the ARP table
   (`/proc/net/arp`). If the Kindle isn't in the table yet, it probes the
   local /24 subnet to populate it. You can also set a fixed IP instead.
2. Runs `ssh … mkdir -p <folder>` and then `scp -O <pdf> …` against KOReader's
   built-in SSH server (dropbear, port 2222, user `root`).

Linux only for now (relies on `/proc/net/arp`, `ssh` and `scp`). Works with
the Flatpak build of Zotero, whose runtime ships OpenSSH and has access to `~/.ssh`.

## Kindle setup (one time)

1. Copy your public key to the Kindle (over USB):
   `koreader/settings/SSH/authorized_keys` ← contents of `~/.ssh/id_ed25519.pub`
2. In KOReader: **Tools → More tools → SSH server → Start SSH server**.
   (Optionally tick “Start SSH server with KOReader” so it's always on.)
3. Keep the Kindle awake with Wi-Fi on when sending. A sleeping Kindle drops off
   the network.

## Install

```bash
./build.sh   # → build/send-to-kindle-<version>.xpi
```

In Zotero: **Tools → Plugins → ⚙ → Install Plugin From File…** and pick the `.xpi`.

## Settings

**Edit → Settings → Send to Kindle**:

- MAC address (default `74:58:F3:9B:22:63`)
- Fixed IP/hostname (optional)
- SSH port / user / key file
- Base folder (default `/mnt/us/documents/Papers`)
- **Test connection** button

## License

MIT
# zotero-send-to-kindle
