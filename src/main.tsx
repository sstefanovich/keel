import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./design.css";
import "./ui/theme"; // applies the saved light/dark choice and follows the OS when set to System
import "./ui/editorWidth"; // applies the saved text-column width

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
