import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../../AppShell.jsx';
import { api } from '../../api.js';
import { Card, Empty, ErrorBox, PageHeader, Spinner, useLoad } from '../../ui.jsx';
import { useRealtime } from '../../realtime.js';
import { ChatThread } from '../restaurateur/Contact.jsx';
import { dateTime } from '../../format.js';

function Inbox() {
  const { id } = useParams();
  const navigate = useNavigate();
  const threads = useLoad(() => api.get('/api/support/threads'));
  const thread = useLoad(() => (id ? api.get(`/api/support/threads/${id}`) : Promise.resolve(null)), [id]);
  useRealtime('message', () => { threads.reload(true); if (id) thread.reload(true); });
  return (
    <>
      <PageHeader title="Messagerie" subtitle="Échanges avec les restaurateurs" />
      <ErrorBox error={threads.error} onRetry={threads.reload} />
      <div className="support-layout">
        <Card pad={false} className={id ? 'hide-mobile' : ''}>
          {threads.loading && !threads.data ? <Spinner /> : !threads.data?.threads.length ? <Empty icon="chat" title="Aucune conversation" /> : threads.data.threads.map((t) => (
            <button key={t.id} type="button" className={`thread ${Number(id) === t.id ? 'is-active' : ''}`} onClick={() => navigate(`/support/${t.id}`)}>
              <div className="row row--between"><strong>{t.company || `${t.first_name} ${t.last_name}`}</strong>{t.unread > 0 && <span className="tabs__count">{t.unread}</span>}</div>
              <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.last_body}</div>
              <div className="tiny muted">{dateTime(t.last_at)}</div>
            </button>
          ))}
        </Card>
        <div>
          {!id ? <Card className="hide-mobile"><Empty icon="chat" title="Sélectionnez une conversation" /></Card>
            : thread.loading && !thread.data ? <Spinner />
            : thread.data && (
              <>
                <p className="small" style={{ marginBottom: 8 }}><strong>{thread.data.restaurateur.first_name} {thread.data.restaurateur.last_name}</strong> · {thread.data.restaurateur.company} · {thread.data.restaurateur.email}</p>
                <ChatThread messages={thread.data.messages} mine={(m) => !!m.from_mizu} placeholder="Répondre…" empty="Aucun message."
                  onSend={async (body) => { await api.post(`/api/support/threads/${id}`, { body }); await thread.reload(true); threads.reload(true); }} />
              </>
            )}
        </div>
      </div>
    </>
  );
}

export default function SupportApp() {
  const nav = [{ to: '/support', end: false, label: 'Messagerie', icon: 'chat' }];
  return (
    <AppShell nav={nav} mobileNav={nav} spaceLabel="Équipe Mizu">
      <Routes>
        <Route index element={<Inbox />} />
        <Route path=":id" element={<Inbox />} />
        <Route path="*" element={<Navigate to="/support" replace />} />
      </Routes>
    </AppShell>
  );
}
