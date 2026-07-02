/**
 * motion-ui entry point.
 *
 * Bootstraps the application shell and mounts either the editor or the
 * presenter view depending on the URL path.
 */
import { mountEditor } from "./editor/EditorApp.js";
import { mountPresenter } from "./presenter/PresenterApp.js";

const path = window.location.pathname;

if (path.startsWith("/present")) {
  mountPresenter(document.getElementById("app")!);
} else {
  mountEditor(document.getElementById("app")!);
}
