import React from 'react';
import ChatPanel, {ChatHistory} from '../ChatPanel.jsx';
import {PageHeading} from '../components/PageChrome.jsx';

// Sur grand écran : historique et échange côte à côte. Sur téléphone : la liste, puis l’échange choisi (bouton retour).
export default function ChatPage({threads, thread, busy, sending, panelProps, onSelect, onCreate, onDelete, onClose}) {
  return <div className="chat-route" data-view={thread ? 'thread' : 'list'}>
    <PageHeading number="02" title="Une question." emphasis="Des perspectives." description="Posez vos questions : les passages utiles sont recherchés automatiquement dans vos archives, et chaque réponse cite ses sources."/>
    <div className="conversations-page">
      <ChatHistory threads={threads} activeId={thread?.id} onSelect={onSelect} onCreate={onCreate} onDelete={onDelete} busy={busy || sending}/>
      <ChatPanel thread={thread} {...panelProps} onBack={thread ? onClose : undefined}/>
    </div>
  </div>;
}
