import { createRoot } from "react-dom/client";
import "./style.css";
import { Studio } from "./Studio";
import { PayPage } from "./PayPage";
import { ClaimPage } from "./ClaimPage";
import { PaperGears } from "./PaperGears";

const path = location.pathname.replace(/\/$/, "");
const Page = path === "/pay" ? PayPage : path === "/claim" ? ClaimPage : path === "/paper" ? PaperGears : Studio;
createRoot(document.getElementById("root")!).render(<Page />);
