import React from 'react';
import {createRoot} from 'react-dom/client';
import AuthGateway from './AuthGateway.jsx';
import './app.css';
import './immersive.css';
import './auth.css';
createRoot(document.getElementById('root')).render(<React.StrictMode><AuthGateway/></React.StrictMode>);
