// Required by App Router for parallel routes with no match at the current URL.
// Returning null prevents a 404 when no intercepting route is active.
export default function ModalDefault() {
  return null;
}
