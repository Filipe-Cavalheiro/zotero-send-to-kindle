/* global Zotero, document */
// Delegated, since this script may run before the pane fragment is inserted
document.addEventListener("command", async (event) => {
  if (event.target.id !== "sendtokindle-test") {
    return;
  }
  let result = document.getElementById("sendtokindle-test-result");
  result.value = "Connecting…";
  try {
    let host = await Zotero.SendToKindle.testConnection();
    result.value = `Connected to ${host}`;
  }
  catch (e) {
    result.value = e.message;
  }
});
