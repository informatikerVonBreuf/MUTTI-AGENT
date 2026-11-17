// Point d’entrée de compatibilité : scripts/check-chat-ui.mjs importe encore HomePage et PageScenery depuis ce fichier.
// Le code de l’application importe directement components/PageChrome.jsx et pages/HomePage.jsx.
export {PageScenery, PageHeading, MotionControl} from './components/PageChrome.jsx';
export {default as HomePage} from './pages/HomePage.jsx';
