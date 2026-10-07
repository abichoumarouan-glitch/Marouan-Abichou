// Fichier photographié depuis une action rapide, transmis à la page qui le traite.
let pending = null;
export const setPendingFile = (kind, file) => { pending = { kind, file }; };
export const takePendingFile = (kind) => {
  if (pending?.kind !== kind) return null;
  const f = pending.file;
  pending = null;
  return f;
};
