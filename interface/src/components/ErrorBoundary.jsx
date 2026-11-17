import React from 'react';

// Une erreur d’affichage ne doit jamais laisser une page blanche et muette.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {error: null};
  }
  static getDerivedStateFromError(error) {
    return {error};
  }
  componentDidCatch(error, info) {
    console.error('Folio : erreur d’affichage', error, info?.componentStack);
  }
  componentDidUpdate(previous) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({error: null});
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="simple-empty app-crash" role="alert">
      <h2>Cette page n’a pas pu s’afficher.</h2>
      <p>Une erreur inattendue s’est produite dans l’interface. Vos documents et vos conversations ne sont pas affectés.</p>
      <button className="button-primary" onClick={() => window.location.reload()}>Recharger la page</button>
    </div>;
  }
}
