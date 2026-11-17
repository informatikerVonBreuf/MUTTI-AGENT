import React from 'react';
import {Pause, Play} from 'lucide-react';
import ReadingScene from '../ReadingScene.jsx';

export function PageScenery({page}) {
  return <div className={'page-scenery scenery-' + page + ' reading-background'} aria-hidden="true"><ReadingScene variant={page}/></div>;
}

export function PageHeading({number, title, emphasis, description, children}) {
  return <header className="editorial-page-heading">
    <span className="eyebrow">{number} / ARCHIVE VIVANTE</span>
    <div><h1>{title}<br/><em>{emphasis}</em></h1>{children}</div>
    {description && <p>{description}</p>}
  </header>;
}

export function MotionControl({paused, onChange}) {
  return <button className="motion-control" onClick={() => onChange(!paused)} aria-pressed={paused} aria-label={paused ? 'Réactiver les animations 3D' : 'Mettre les animations 3D en pause'} title={paused ? 'Réactiver les animations 3D' : 'Mettre les animations 3D en pause'}>
    {paused ? <Play size={12}/> : <Pause size={12}/>}<span>{paused ? '3D en pause' : 'Animations 3D'}</span>
  </button>;
}
