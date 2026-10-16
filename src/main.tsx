import { createRoot } from "react-dom/client";
import "./style.css";
import { Studio } from "./Studio";
import { PayPage } from "./PayPage";
import { ScanPage } from "./claim/ScanPage";
import { AdminPage } from "./claim/AdminPage";
import { PaperGears } from "./PaperGears";

const path = location.pathname.replace(/\/$/, "");
const Page = path.startsWith("/c/") ? ScanPage : path === "/claim-admin" ? AdminPage : path === "/pay" ? PayPage : path === "/claim" ? ScanPage : path === "/paper" ? PaperGears : Studio;
createRoot(document.getElementById("root")!).render(<Page />);
