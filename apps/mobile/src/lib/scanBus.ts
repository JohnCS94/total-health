/** Tiny pub/sub so the barcode scanner can hand a code back to the food search screen. */
type Listener = (barcode: string) => void;
const listeners = new Set<Listener>();

export const onBarcode = (l: Listener) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const emitBarcode = (code: string) => listeners.forEach((l) => l(code));
