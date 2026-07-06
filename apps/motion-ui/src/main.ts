/**
 * motion-ui entry point.
 *
 * Bootstraps the application shell and mounts either the editor, the
 * presenter view, or the presenter notes panel depending on the URL path.
 */
import { mountEditor } from "./editor/EditorApp.js";
import { mountPresenter } from "./presenter/PresenterApp.js";
import { mountPresenterView } from "./presenter/PresenterViewApp.js";

const path = window.location.pathname;

if (path.startsWith("/presenter-view")) {
  mountPresenterView(document.getElementById("app")!);
} else if (path.startsWith("/present")) {
  mountPresenter(document.getElementById("app")!);
} else {
  mountEditor(document.getElementById("app")!);
}
