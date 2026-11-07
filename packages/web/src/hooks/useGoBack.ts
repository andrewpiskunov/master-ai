import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// Возврат на предыдущую страницу через историю браузера. Если истории внутри
// приложения нет (прямой заход / первая запись стека — location.key === "default"),
// уходим на fallback, чтобы не выпасть из приложения.
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (location.key && location.key !== "default") navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, location.key, fallback]);
}
