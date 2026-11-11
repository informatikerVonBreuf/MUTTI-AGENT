import React from 'react';
import BookSculpture from './BookSculpture.jsx';

export function FolioMark({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4h11v4H8v12H4V4Z" fill="currentColor" /><path d="M11 11h9v3h-9zM11 17h5v3h-5z" fill="currentColor" /><circle cx="20" cy="19" r="1.5" fill="currentColor" /></svg>;
}

export function ResearchWeave() {
  return <div className="research-weave"><BookSculpture /><span className="weave-caption">OBJET 01 — OUVRIR DE NOUVELLES LECTURES</span></div>;
}
