import React from 'react';
import {Check, Copy, KeyRound, LaptopMinimal, LogOut, ShieldCheck, Trash2, UserPlus, Users} from 'lucide-react';
import {api, json} from '../api.mjs';
import {PageHeading} from '../components/PageChrome.jsx';
import {companyLabel, formatFullDate, formatRelative, plural} from '../format.mjs';

function useLoad(load, deps) {
  const [state, setState] = React.useState({data: null, error: '', loading: true});
  const reload = React.useCallback(async () => {
    setState(current => ({...current, loading: true}));
    try { setState({data: await load(), error: '', loading: false}); } catch (error) { setState({data: null, error: error.message, loading: false}); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { reload(); }, [reload]);
  return [state, reload];
}

function CopyCode({code, label}) {
  const [copied, setCopied] = React.useState(false);
  return <div className="account-code"><code>{code}</code><button type="button" className="button-secondary" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch {} }}><Copy size={13}/>{copied ? 'Copié' : label}</button></div>;
}

function PasswordForm({forced, onDone}) {
  const [fields, setFields] = React.useState({currentPassword: '', newPassword: '', confirm: ''});
  const [state, setState] = React.useState({busy: false, error: '', done: false});
  const set = key => event => { setFields(previous => ({...previous, [key]: event.target.value})); setState(previous => ({...previous, error: ''})); };
  async function submit(event) {
    event.preventDefault();
    if (fields.newPassword.length < 12) return setState({busy: false, error: 'Au moins 12 caractères.', done: false});
    if (fields.newPassword !== fields.confirm) return setState({busy: false, error: 'Les deux mots de passe ne correspondent pas.', done: false});
    setState({busy: true, error: '', done: false});
    try { await api('/api/account/password', json('POST', {currentPassword: fields.currentPassword, newPassword: fields.newPassword})); setFields({currentPassword: '', newPassword: '', confirm: ''}); setState({busy: false, error: '', done: true}); onDone?.(); }
    catch (error) { setState({busy: false, error: error.message, done: false}); }
  }
  return <form className="account-form" onSubmit={submit} noValidate>
    <label>{forced ? 'Code d’invitation reçu' : 'Mot de passe actuel'}<input type="password" autoComplete="current-password" value={fields.currentPassword} onChange={set('currentPassword')} required/></label>
    <label>Nouveau mot de passe<input type="password" autoComplete="new-password" value={fields.newPassword} onChange={set('newPassword')} minLength={12} maxLength={1024} required/></label>
    <label>Confirmer<input type="password" autoComplete="new-password" value={fields.confirm} onChange={set('confirm')} required/></label>
    <p className="field-help">Au moins 12 caractères, pas un mot de passe courant ni votre adresse. Une phrase de plusieurs mots est idéale. Vos autres sessions seront fermées.</p>
    {state.error && <p className="auth-field-error" role="alert">{state.error}</p>}
    {state.done && <p className="account-success" role="status"><Check size={14}/>Mot de passe modifié.</p>}
    <button type="submit" className="button-primary" disabled={state.busy}>{state.busy ? 'Enregistrement…' : forced ? 'Choisir mon mot de passe' : 'Changer le mot de passe'}</button>
  </form>;
}

function MfaSection({enabled, onChange}) {
  const [setup, setSetup] = React.useState(null), [code, setCode] = React.useState(''), [password, setPassword] = React.useState('');
  const [state, setState] = React.useState({busy: false, error: ''});
  async function run(action) { setState({busy: true, error: ''}); try { await action(); setState({busy: false, error: ''}); } catch (error) { setState({busy: false, error: error.message}); } }
  const begin = () => run(async () => { setSetup(await api('/api/account/mfa/setup', json('POST', {}))); });
  const confirm = event => { event.preventDefault(); run(async () => { await api('/api/account/mfa/enable', json('POST', {code, password})); setSetup(null); setCode(''); setPassword(''); onChange(); }); };
  const disable = event => { event.preventDefault(); run(async () => { await api('/api/account/mfa/disable', json('POST', {code, password})); setCode(''); setPassword(''); onChange(); }); };
  return <section className="account-section" aria-labelledby="account-mfa">
    <h2 id="account-mfa"><ShieldCheck size={17}/>Double authentification <span className={'account-badge ' + (enabled ? 'is-on' : 'is-off')}>{enabled ? 'active' : 'inactive'}</span></h2>
    <p>Un code à 6 chiffres, généré par une application d’authentification (Google Authenticator, Microsoft Authenticator, Aegis, 1Password…), est demandé après le mot de passe.</p>
    {!enabled && !setup && <button type="button" className="button-primary" onClick={begin} disabled={state.busy}><KeyRound size={14}/>Activer la double authentification</button>}
    {!enabled && setup && <form className="account-form" onSubmit={confirm}>
      <ol className="account-steps"><li>Dans votre application, choisissez « Saisir une clé de configuration » et copiez cette clé (type : basée sur le temps) :<CopyCode code={setup.secret.replace(/(.{4})/g, '$1 ').trim()} label="Copier la clé"/></li>
        <li>Ou ouvrez ce lien sur un appareil qui gère les liens <code>otpauth://</code> :<CopyCode code={setup.otpauthUrl} label="Copier le lien"/></li>
        <li>Saisissez le code affiché et votre mot de passe pour confirmer.</li></ol>
      <label>Code à 6 chiffres<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required/></label>
      <label>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required/></label>
      <button type="submit" className="button-primary" disabled={state.busy}>Confirmer l’activation</button>
    </form>}
    {enabled && <form className="account-form" onSubmit={disable}>
      <p className="field-help">Pour désactiver, confirmez avec un code actuel et votre mot de passe.</p>
      <label>Code à 6 chiffres<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required/></label>
      <label>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required/></label>
      <button type="submit" className="button-secondary" disabled={state.busy}>Désactiver</button>
    </form>}
    {state.error && <p className="auth-field-error" role="alert">{state.error}</p>}
  </section>;
}

function SessionsSection() {
  const [{data, error}, reload] = useLoad(() => api('/api/account/sessions'), []);
  const [message, setMessage] = React.useState('');
  async function revoke() { try { const result = await api('/api/account/sessions/revoke-others', json('POST', {})); setMessage(result.revoked ? plural(result.revoked, 'session fermée', 'sessions fermées') + '.' : 'Aucune autre session ouverte.'); reload(); } catch (err) { setMessage(err.message); } }
  const sessions = data?.sessions || [];
  return <section className="account-section" aria-labelledby="account-sessions">
    <h2 id="account-sessions"><LaptopMinimal size={17}/>Sessions actives <span className="count-badge">{sessions.length}</span></h2>
    {error && <p className="auth-field-error">{error}</p>}
    <ul className="account-sessions">{sessions.map(session => <li key={session.id} className={session.current ? 'is-current' : ''}>
      <strong>{session.device}</strong>{session.current && <span className="account-badge is-on">cet appareil</span>}
      <span>Ouverte {session.createdAt ? formatRelative(session.createdAt) : 'à une date inconnue'} · expire {formatRelative(session.expiresAt)}</span>
    </li>)}</ul>
    {sessions.length > 1 && <button type="button" className="button-secondary" onClick={revoke}><LogOut size={14}/>Déconnecter les autres sessions</button>}
    {message && <p className="account-success" role="status">{message}</p>}
  </section>;
}

function MembersSection({companies}) {
  const [{data, error}, reload] = useLoad(() => api('/api/accounts'), []);
  const [email, setEmail] = React.useState(''), [chosen, setChosen] = React.useState(['*']), [issued, setIssued] = React.useState(null), [state, setState] = React.useState({busy: false, error: ''}), [confirmDelete, setConfirmDelete] = React.useState('');
  const members = data?.members || [];
  const toggle = company => setChosen(previous => company === '*' ? ['*'] : previous.includes(company) ? (previous.filter(item => item !== company && item !== '*').length ? previous.filter(item => item !== company && item !== '*') : ['*']) : [...previous.filter(item => item !== '*'), company]);
  async function run(action) { setState({busy: true, error: ''}); try { await action(); setState({busy: false, error: ''}); reload(); } catch (err) { setState({busy: false, error: err.message}); } }
  const create = event => { event.preventDefault(); run(async () => { const result = await api('/api/accounts', json('POST', {email, companies: chosen})); setIssued({email: result.member.email, code: result.invitationCode}); setEmail(''); setChosen(['*']); }); };
  return <section className="account-section account-members" aria-labelledby="account-members">
    <h2 id="account-members"><Users size={17}/>Sous-comptes <span className="count-badge">{members.length}</span></h2>
    <p>Chaque sous-compte a ses propres conversations, invisibles des autres comptes, et ne consulte que les entreprises que vous autorisez. Il ne peut ni gérer les comptes ni voir les mesures globales.</p>
    {error && <p className="auth-field-error">{error}</p>}
    {issued && <div className="account-issued" role="status"><p><strong>Invitation créée pour {issued.email}.</strong> Transmettez ce code par un canal sûr : il sert de mot de passe provisoire à la première connexion, puis doit être remplacé. Il ne sera plus affiché.</p><CopyCode code={issued.code} label="Copier le code"/><button type="button" className="text-button" onClick={() => setIssued(null)}>J’ai transmis le code</button></div>}
    <ul className="account-member-list">{members.map(member => <li key={member.id} className={member.disabled ? 'is-disabled' : ''}>
      <div><strong>{member.email}</strong>
        <span>{member.disabled ? 'désactivé' : member.mustChangePassword ? 'invitation en attente' : 'actif'} · {member.companies.includes('*') ? 'tout le corpus' : member.companies.map(companyLabel).join(', ')} · {member.mfaEnabled ? 'double authentification' : 'sans double authentification'}{member.lastLoginAt ? ` · dernière connexion ${formatRelative(member.lastLoginAt)}` : ''}</span></div>
      <div className="account-member-actions">
        <button type="button" className="button-secondary" disabled={state.busy} onClick={() => run(() => api('/api/accounts/' + member.id, json('PATCH', {disabled: !member.disabled})))}>{member.disabled ? 'Réactiver' : 'Désactiver'}</button>
        <button type="button" className="button-secondary" disabled={state.busy} onClick={() => run(async () => { const result = await api('/api/accounts/' + member.id, json('PATCH', {resetInvitation: true})); setIssued({email: member.email, code: result.invitationCode}); })}>Nouvelle invitation</button>
        {confirmDelete === member.id
          ? <><button type="button" className="button-danger" disabled={state.busy} onClick={() => run(async () => { await api('/api/accounts/' + member.id, {method: 'DELETE'}); setConfirmDelete(''); })}>Confirmer la suppression</button><button type="button" className="text-button" onClick={() => setConfirmDelete('')}>Annuler</button></>
          : <button type="button" className="text-button" onClick={() => setConfirmDelete(member.id)}><Trash2 size={13}/>Supprimer</button>}
      </div>
    </li>)}</ul>
    <form className="account-form" onSubmit={create}>
      <label>Adresse e-mail du nouveau compte<input type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} required/></label>
      <fieldset className="account-companies"><legend>Entreprises consultables</legend>
        {['*', ...companies].map(company => <label key={company}><input type="checkbox" checked={chosen.includes(company)} onChange={() => toggle(company)}/>{company === '*' ? 'Tout le corpus' : companyLabel(company)}</label>)}
      </fieldset>
      <button type="submit" className="button-primary" disabled={state.busy || !email.trim()}><UserPlus size={14}/>Créer le sous-compte</button>
    </form>
    {state.error && <p className="auth-field-error" role="alert">{state.error}</p>}
  </section>;
}

export default function AccountPage({companies = [], forced = false, onPasswordChanged}) {
  const [{data, error}, reload] = useLoad(() => api('/api/account'), []);
  return <div className="page account-page">
    <PageHeading number="COMPTE" title={forced ? 'Choisissez' : 'Votre accès,'} emphasis={forced ? 'votre mot de passe.' : 'sous votre contrôle.'} description={forced ? 'Votre accès a été créé par le propriétaire de l’atelier. Remplacez le code d’invitation par un mot de passe personnel pour continuer.' : 'Mot de passe, double authentification, sessions ouvertes et, pour le propriétaire, sous-comptes.'}/>
    {error && <p className="simple-empty" role="alert">{error}</p>}
    {data && <section className="account-section account-identity" aria-label="Identité">
      <p><strong>{data.email}</strong> · {data.role === 'owner' ? 'propriétaire de l’atelier' : 'sous-compte'}{data.companies ? ` · ${data.companies.includes('*') ? 'tout le corpus' : data.companies.map(companyLabel).join(', ')}` : ''}</p>
      <p className="field-help">Compte créé {data.createdAt ? formatFullDate(data.createdAt) : '—'}{data.lastLoginAt ? ` · dernière connexion ${formatRelative(data.lastLoginAt)}` : ''}</p>
    </section>}
    <section className="account-section" aria-labelledby="account-password"><h2 id="account-password"><KeyRound size={17}/>{forced ? 'Mot de passe personnel' : 'Mot de passe'}</h2><PasswordForm forced={forced} onDone={() => { reload(); onPasswordChanged?.(); }}/></section>
    {!forced && data && <MfaSection enabled={data.mfaEnabled} onChange={reload}/>}
    {!forced && <SessionsSection/>}
    {!forced && data?.role === 'owner' && <MembersSection companies={companies}/>}
  </div>;
}
