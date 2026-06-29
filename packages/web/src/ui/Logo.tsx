// Логотип master-ai — d20 (двадцатигранник), универсальный символ настольных ролевых игр.
// Та же графика, что и в public/favicon.svg.
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="master-ai" className="app-logo">
      <polygon points="50,5 11.03,27.5 11.03,72.5 50,95 88.97,72.5 88.97,27.5" fill="#4f46e5" />
      <polygon points="50,5 11.03,72.5 88.97,72.5" fill="#6366f1" />
      <g stroke="#c7d2fe" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" fill="none">
        <polygon points="50,5 11.03,27.5 11.03,72.5 50,95 88.97,72.5 88.97,27.5" />
        <polygon points="50,5 11.03,72.5 88.97,72.5" />
        <line x1="30.5" y1="38.75" x2="11.03" y2="27.5" />
        <line x1="69.5" y1="38.75" x2="88.97" y2="27.5" />
        <line x1="50" y1="72.5" x2="50" y2="95" />
      </g>
      <text x="50" y="59" textAnchor="middle" fontSize="24" fontWeight="700" fill="#ffffff">20</text>
    </svg>
  );
}
