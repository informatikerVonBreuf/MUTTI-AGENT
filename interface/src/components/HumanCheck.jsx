import React from 'react';
import {Check, LoaderCircle, RefreshCw, ShieldCheck} from 'lucide-react';
import {fetchHumanChallenge, solveHumanChallenge} from '../human-check.mjs';

// Case « Je ne suis pas un robot » : le navigateur résout un petit calcul (quelques secondes au plus).
// Le champ « site web » est un piège invisible pour les humains ; un automate qui le remplit est refusé.
export default function HumanCheck({onChange, resetKey = 0, disabled = false}) {
  const [state, setState] = React.useState({status: 'idle', progress: 0, error: ''});
  const [trap, setTrap] = React.useState('');
  const controller = React.useRef(null), proof = React.useRef(null), expiry = React.useRef(null);
  const report = React.useCallback(value => onChange?.(value ? {...value, trap} : null), [onChange, trap]);
  React.useEffect(() => { report(proof.current); }, [trap]); // eslint-disable-line react-hooks/exhaustive-deps
  // Un défi ne sert qu'une fois : après chaque envoi du formulaire, la case est à cocher de nouveau.
  React.useEffect(() => {
    controller.current?.abort(); clearTimeout(expiry.current); proof.current = null;
    setState({status: 'idle', progress: 0, error: ''}); onChange?.(null);
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => () => { controller.current?.abort(); clearTimeout(expiry.current); }, []);
  async function start() {
    if (disabled || state.status === 'solving' || state.status === 'verified') return;
    controller.current?.abort();
    const current = controller.current = new AbortController();
    setState({status: 'solving', progress: 0, error: ''});
    try {
      const challenge = await fetchHumanChallenge(current.signal);
      const started = Date.now(), expected = 2 ** challenge.difficulty;
      const nonce = await solveHumanChallenge(challenge, {signal: current.signal, onProgress: tries => setState(previous => ({...previous, progress: Math.min(95, Math.round(tries / expected * 100))}))});
      // Le serveur exige un court délai minimal entre le défi et l'envoi : on le respecte avant de valider.
      const wait = 900 - (Date.now() - started);
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      if (current.signal.aborted) return;
      proof.current = {challenge: challenge.challenge, nonce};
      setState({status: 'verified', progress: 100, error: ''});
      report(proof.current);
      expiry.current = setTimeout(() => { proof.current = null; setState({status: 'idle', progress: 0, error: 'La vérification a expiré : cochez de nouveau.'}); onChange?.(null); }, Math.max(10000, challenge.expiresAt - Date.now() - 15000));
    } catch (error) {
      if (error.name === 'AbortError') return;
      setState({status: 'error', progress: 0, error: error.message || 'La vérification a échoué.'});
    }
  }
  const verified = state.status === 'verified', solving = state.status === 'solving';
  return <div className={'human-check is-' + state.status}>
    <button type="button" role="checkbox" aria-checked={verified} aria-describedby="human-check-help" className="human-check-box" onClick={start} disabled={disabled || solving}>
      <span className="human-check-tick" aria-hidden="true">{verified ? <Check size={16}/> : solving ? <LoaderCircle size={16} className="run-step-spinner"/> : null}</span>
      <span className="human-check-label">{verified ? 'Vérifié : vous pouvez continuer' : solving ? `Vérification en cours… ${state.progress} %` : 'Je ne suis pas un robot'}</span>
      <ShieldCheck size={18} className="human-check-shield" aria-hidden="true"/>
    </button>
    <p id="human-check-help" className="human-check-help">Vérification locale : votre navigateur résout un petit calcul. Aucun service tiers, aucun suivi.</p>
    {state.error && <p className="auth-field-error" role="status">{state.error} {state.status === 'error' && <button type="button" className="text-button" onClick={start}><RefreshCw size={12}/>Réessayer</button>}</p>}
    <div className="human-trap" aria-hidden="true"><label htmlFor="human-website">Site web</label><input id="human-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={event => setTrap(event.target.value)}/></div>
  </div>;
}
