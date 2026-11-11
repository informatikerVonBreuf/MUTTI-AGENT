import React, { useEffect, useRef, useState } from 'react';
import './book-sculpture.css';

function PageDrawing({ variant = 'text' }) {
  return <span className={`page-drawing drawing-${variant}`}>
    <span className="page-running-head">FOLIO / LECTURES</span>
    <span className="page-hairline" />
    {variant === 'chart' ? <><span className="page-chart"><i /><i /><i /><i /><i /></span><span className="page-caption">METTRE EN PERSPECTIVE</span></> : variant === 'table' ? <><span className="page-table">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</span><span className="page-caption">CROISER LES SOURCES</span></> : <><span className="page-initial">L</span><span className="page-text-lines">{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</span></>}
    <span className="page-folio">{variant === 'chart' ? '03' : variant === 'table' ? '02' : '01'}</span>
  </span>;
}

export default function BookSculpture() {
  const [open, setOpen] = useState(false);
  const sceneRef = useRef(null);
  const autoOpen = useRef(null);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) { setOpen(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        autoOpen.current = window.setTimeout(() => setOpen(true), 700);
        observer.disconnect();
      }
    }, { threshold: 0.3 });
    if (sceneRef.current) observer.observe(sceneRef.current);
    return () => { observer.disconnect(); window.clearTimeout(autoOpen.current); };
  }, []);
  function toggle() { window.clearTimeout(autoOpen.current); setOpen(value => !value); }
  function tilt(event) {
    if (event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--look-x', `${((event.clientX - rect.left) / rect.width - 0.5) * 9}deg`);
    event.currentTarget.style.setProperty('--look-y', `${((event.clientY - rect.top) / rect.height - 0.5) * -6}deg`);
  }
  function resetTilt(event) { event.currentTarget.style.setProperty('--look-x', '0deg'); event.currentTarget.style.setProperty('--look-y', '0deg'); }
  return <div className="book-sculpture" ref={sceneRef}>
    <span className="object-catalogue" aria-hidden="true"><b>F / 001</b><span>ARCHIVE<br />VIVANTE</span></span>
    <button className={`book-stage ${open ? 'is-open' : ''}`} onClick={toggle} onPointerMove={tilt} onPointerLeave={resetTilt} aria-label={open ? 'Refermer le livre en trois dimensions' : 'Ouvrir le livre en trois dimensions'} aria-pressed={open}>
      <span className="book-ground-shadow" aria-hidden="true" />
      <span className="archive-slip" aria-hidden="true"><span>LECTURES CROISÉES</span><i /><i /><i /><b>01—04</b></span>
      <span className="book-world" aria-hidden="true">
        <span className="book-back-cover" />
        <span className="book-spine"><span>FOLIO · ARCHIVE VIVANTE</span></span>
        <span className="book-page-edge edge-fore" />
        <span className="book-page-edge edge-bottom" />
        <span className="book-page-base"><PageDrawing variant="chart" /></span>
        <span className="book-ribbon" />
        <span className="book-leaf leaf-three"><span className="leaf-face leaf-recto"><PageDrawing variant="table" /></span><span className="leaf-face leaf-verso"><PageDrawing /></span></span>
        <span className="book-leaf leaf-two"><span className="leaf-face leaf-recto"><PageDrawing /></span><span className="leaf-face leaf-verso"><PageDrawing variant="table" /></span></span>
        <span className="book-leaf leaf-one"><span className="leaf-face leaf-recto"><PageDrawing /></span><span className="leaf-face leaf-verso"><PageDrawing /></span></span>
        <span className="book-cover"><span className="cover-face cover-outside"><span className="cover-frame" /><span className="cover-topline">ATELIER DE RECHERCHE</span><span className="cover-title">folio<span>.</span></span><span className="cover-subtitle">ARCHIVE<br />VIVANTE</span><span className="cover-ornament">§</span><span className="cover-edition">LECTURES CROISÉES <b>01</b></span></span><span className="cover-face cover-inside"><span className="inside-border" /><span className="inside-exlibris">EX LIBRIS</span><span className="inside-title">Chaque source<br />ouvre une<br /><em>perspective.</em></span><span className="inside-signature">f.</span></span></span>
      </span>
      <span className="book-control-hint"><span>{open ? '−' : '+'}</span>{open ? 'REFERMER LE LIVRE' : 'OUVRIR LE LIVRE'}</span>
    </button>
    <span className="object-measure" aria-hidden="true"><i /><span>MATIÈRE / SAVOIR / PERSPECTIVE</span><i /></span>
  </div>;
}
