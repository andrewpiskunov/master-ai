let locks = 0;
let previousOverflow = "";

// Просмотр и подтверждение могут закрыться за один рендер, в любом порядке.
export function lockImageScroll(): () => void {
  if (locks++ === 0) previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) document.body.style.overflow = previousOverflow;
  };
}
