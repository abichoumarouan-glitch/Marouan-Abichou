import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Button, ErrorBox, PageHeader, Spinner, useAction, useLoad } from '../../ui.jsx';
import { useRealtime } from '../../realtime.js';
import { dateTime } from '../../format.js';

/** Fil de discussion réutilisé par le restaurateur et par l'équipe Mizu. */
export function ChatThread({ messages, mine, onSend, placeholder = 'Votre message…', empty }) {
  const [text, setText] = useState('');
  const [run, busy] = useAction();
  const end = useRef();
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
  const send = () => text.trim() && run(async () => { await onSend(text.trim()); setText(''); });
  return (
    <div className="chat">
      <div className="chat__list">
        {!messages.length && <p className="muted small center">{empty}</p>}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${mine(m) ? 'bubble--me' : 'bubble--them'}`}>
            {m.body}
            <div className="bubble__meta">{m.from_mizu ? 'Équipe Mizu' : `${m.first_name} ${m.last_name}`.trim()} · {dateTime(m.created_at)}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="chat__form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 860) { e.preventDefault(); send(); } }} />
        <Button type="submit" variant="primary" icon="send" loading={busy} aria-label="Envoyer" />
      </form>
    </div>
  );
}

export default function Contact() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.get('/api/r/messages'));
  useRealtime('message', () => reload(true));
  if (loading && !data) return <Spinner />;
  return (
    <>
      <PageHeader title="Contact" subtitle="Une question, un besoin ? L’équipe Mizu vous répond ici." />
      <ErrorBox error={error} onRetry={reload} />
      <ChatThread
        messages={data?.messages || []}
        mine={(m) => m.author_id === user.id}
        empty="Écrivez-nous : nous vous répondons en général dans la journée."
        onSend={async (body) => { await api.post('/api/r/messages', { body }); await reload(true); }}
      />
    </>
  );
}
