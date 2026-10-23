import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/source-serif-4";
import "./styles.css";
import "./design.css";
import "./look.css";
import "./ui/theme"; // applies the saved light/dark choice and follows the OS when set to System
import "./ui/editorWidth"; // applies the saved text-column width
import { applyBackdrop } from "./lib/platform";

void applyBackdrop();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
