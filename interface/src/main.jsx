import React from 'react';
import {createRoot} from 'react-dom/client';
// L’ordre des feuilles de style fait partie de la cascade : objets 3D, fondations, puis une feuille par zone.
import './book-sculpture.css';
import './reading-scene.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/modal.css';
import './styles/shell.css';
import './styles/home.css';
import './styles/library.css';
import './styles/chat.css';
import './styles/themes.css';
import './styles/auth.css';
import AuthGateway from './AuthGateway.jsx';

createRoot(document.getElementById('root')).render(<React.StrictMode><AuthGateway/></React.StrictMode>);
