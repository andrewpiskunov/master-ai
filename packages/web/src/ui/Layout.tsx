import { Link, Outlet } from "react-router-dom";
import { Logo } from "./Logo.js";

// Общий каркас приложения: липкая шапка с логотипом + контент страницы.
export function Layout() {
  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="brand">
            <Logo size={28} />
            <span className="brand-name">MasterAI</span>
          </Link>
        </div>
      </header>
      <Outlet />
    </>
  );
}
