import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import type { ApiClient } from '../api/client';
import { PAGE_SIZE, visibleProfileSections, type FriendRequest, type PublicProfile } from '../api/profiles';
import { socialApi } from '../api/social';
import { Action, Info, Input, styles } from '../components/ProfileUI';

type Tab = 'search' | 'friends' | 'requests';
const tabLabels: Record<Tab, string> = { search: 'Rechercher', friends: 'Mes amis', requests: 'Demandes' };

export function PeopleScreen({ client, userId, onBusy }: {
  client: ApiClient; userId: string; onBusy: (busy: boolean) => void;
}) {
  const api = useMemo(() => socialApi(client), [client]);
  const [tab, setTab] = useState<Tab>('search');
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState('');
  const [filters, setFilters] = useState({ q: '', genre: '' });
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [rows, setRows] = useState<(PublicProfile | FriendRequest)[]>([]);
  const [selected, setSelected] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(false);
  const working = useRef(false);
  const disabled = loading || busy;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => { onBusy(disabled); return () => onBusy(false); }, [disabled, onBusy]);

  useEffect(() => {
    let active = true;
    setLoading(true); setRows([]); setSelected(null); setError('');
    const request = tab === 'search' ? api.search(filters.q, filters.genre, page)
      : tab === 'friends' ? api.friends(page) : api.pending(page);
    void request.then(result => { if (active) setRows(result); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Chargement impossible.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, tab, filters.q, filters.genre, page, reload]);

  async function action(operation: () => Promise<void>) {
    if (working.current || loading) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Action impossible.'); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  function refresh(message: string) {
    if (!alive.current) return;
    setNotice(message); setSelected(null); setReload(value => value + 1);
  }
  function openProfile(person: PublicProfile) {
    void action(async () => {
      // Fetch each time: friendship may have changed since the list was loaded.
      const profile = await api.profile(person.id);
      if (alive.current) setSelected(profile);
    });
  }
  function send(person: PublicProfile) {
    void action(async () => {
      const result = await api.send(person.id);
      refresh(result.status === 'ACCEPTED' ? 'Vous êtes maintenant amis.' : 'Demande envoyée.');
    });
  }
  function remove(person: PublicProfile) {
    Alert.alert('Retirer cet ami ?', `${person.name} n’aura plus accès à tes informations réservées aux amis.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () => {
        if (alive.current) void action(async () => { await api.remove(person.id); refresh('Ami retiré.'); });
      } },
    ]);
  }
  function changeTab(next: Tab) {
    setRows([]); setSelected(null); setTab(next); setPage(1); setNotice(''); setError(''); setReload(value => value + 1);
  }

  return <View style={styles.section}>
    <Text style={styles.title}>Amis et découvertes</Text>
    <View style={styles.row}>{(Object.keys(tabLabels) as Tab[]).map(key =>
      <Action key={key} title={tabLabels[key]} secondary={tab !== key} disabled={disabled} onPress={() => changeTab(key)} />
    )}</View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {disabled ? <ActivityIndicator color="#B7F576" accessibilityLabel="Chargement des personnes" /> : null}
    {selected ? <>
      <Text style={styles.title}>{selected.name}</Text>
      <Text style={styles.label}>Genres musicaux</Text>
      <Text style={styles.text}>{selected.musicPreferences.join(', ') || 'Aucun genre renseigné.'}</Text>
      {visibleProfileSections(selected).map(section => <Info key={section.title} {...section} />)}
      {!Object.hasOwn(selected, 'friendsOnlyInfo') ? <Text style={styles.text}>Les informations réservées aux amis ne sont pas accessibles.</Text> : null}
      <Action title="Retour à la liste" secondary disabled={disabled} onPress={() => setSelected(null)} />
    </> : <>
      {tab === 'search' ? <>
        <Input label="Rechercher par nom" value={q} onChange={setQ} maxLength={100} disabled={disabled} />
        <Input label="Genre musical (facultatif)" value={genre} onChange={setGenre} maxLength={50} disabled={disabled} />
        <Action title="Rechercher des personnes" disabled={disabled} onPress={() => {
          setFilters({ q: q.trim(), genre: genre.trim().toLowerCase() }); setPage(1); setReload(value => value + 1); setNotice('');
        }} />
      </> : null}
      {!loading && rows.filter(row => tab === 'requests' || row.id !== userId).length === 0 && !error ?
        <Text style={styles.text}>{tab === 'requests' ? 'Aucune demande en attente sur cette page.' : 'Aucune personne sur cette page.'}</Text> : null}
      {rows.map(row => {
        if (tab === 'requests') {
          const request = row as FriendRequest;
          const incoming = request.receiverId === userId;
          const person = incoming ? request.sender : request.receiver;
          return <View key={request.id} style={styles.card}>
            <Text style={styles.label}>{incoming ? 'Demande reçue' : 'Demande envoyée'}</Text>
            <Text style={styles.title}>{person.name}</Text>
            <Action title={`Voir le profil de ${person.name}`} secondary disabled={disabled} onPress={() => openProfile(person)} />
            {incoming ? <>
              <Action title="Accepter" disabled={disabled} onPress={() => void action(async () => { await api.accept(request.id); refresh('Demande acceptée.'); })} />
              <Action title="Refuser" secondary disabled={disabled} onPress={() => void action(async () => { await api.reject(request.id); refresh('Demande refusée.'); })} />
            </> : <Action title="Annuler la demande" secondary disabled={disabled} onPress={() => void action(async () => { await api.cancel(request.id); refresh('Demande annulée.'); })} />}
          </View>;
        }
        const person = row as PublicProfile;
        if (person.id === userId) return null;
        return <View key={person.id} style={styles.card}>
          <Text style={styles.title}>{person.name}</Text>
          <Text style={styles.text}>{person.musicPreferences.join(', ') || 'Aucun genre renseigné.'}</Text>
          <Action title={`Voir le profil de ${person.name}`} secondary disabled={disabled} onPress={() => openProfile(person)} />
          <Action title={tab === 'friends' ? 'Retirer de mes amis' : 'Demander en ami'} secondary disabled={disabled}
            onPress={() => tab === 'friends' ? remove(person) : send(person)} />
        </View>;
      })}
      <Text style={styles.text}>Page {page}</Text>
      <View style={styles.row}>
        <Action title="Précédente" secondary disabled={disabled || page === 1} onPress={() => { setPage(p => p - 1); setNotice(''); }} />
        <Action title="Suivante" secondary disabled={disabled || rows.length < PAGE_SIZE || page >= 1000000} onPress={() => { setPage(p => p + 1); setNotice(''); }} />
      </View>
      <Action title="Actualiser la liste" secondary disabled={disabled} onPress={() => { setReload(value => value + 1); setNotice(''); }} />
    </>}
  </View>;
}
