import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import type { ApiClient } from '../api/client';
import { profileDraft, type OwnProfile, type ProfileDraft } from '../api/profiles';
import { Action, Info, Input, styles } from '../components/ProfileUI';
import { acquireGoogleIdToken } from '../auth/native-google';

export function ProfileScreen({ client, onBusy }: { client: ApiClient; onBusy: (busy: boolean) => void }) {
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(false);
  const working = useRef(false);

  useEffect(() => {
    alive.current = true;
    void run(async () => { const p = await client.getMyProfile(); if (alive.current) setProfile(p); });
    return () => { alive.current = false; onBusy(false); };
  }, [client]);

  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); onBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Impossible de charger le profil.'); }
    finally { working.current = false; if (alive.current) { setBusy(false); onBusy(false); } }
  }

  function change(key: keyof ProfileDraft, value: string) { setDraft(current => current ? { ...current, [key]: value } : null); }

  function linkGoogle() {
    Alert.alert('Lier Google à ton compte ?', `Le compte Google choisi permettra de te connecter au compte Sonora ${profile?.email}.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Choisir mon compte Google', onPress: () => {
        if (!alive.current) return;
        void run(async () => {
          const linked = await client.linkGoogle(acquireGoogleIdToken);
          if (!alive.current) return;
          if (linked) {
            // The link endpoint returns the refreshed own profile, already stored in memory.
            setProfile(client.user as OwnProfile); setNotice('Compte Google lié.');
          } else setNotice('Liaison Google annulée.');
        });
      } },
    ]);
  }

  return <View style={styles.section}>
    <Text style={styles.title}>Mon profil</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {busy ? <ActivityIndicator color="#B7F576" accessibilityLabel="Chargement du profil" /> : null}
    {profile && draft ? <>
      <Text style={styles.text}>Le nom, les informations publiques et les genres musicaux sont visibles par tous.</Text>
      <Input label="Nom public" value={draft.name} onChange={v => change('name', v)} disabled={busy} />
      <Input label="Informations publiques" value={draft.publicBio} onChange={v => change('publicBio', v)} multiline disabled={busy} />
      <Text style={styles.text}>La section suivante est accessible uniquement à tes amis.</Text>
      <Input label="Informations pour mes amis" value={draft.friendsBio} onChange={v => change('friendsBio', v)} multiline disabled={busy} />
      <Text style={styles.text}>Ces informations privées sont visibles uniquement par toi.</Text>
      <Input label="Informations privées" value={draft.privateBio} onChange={v => change('privateBio', v)} multiline disabled={busy} />
      <Input label="Genres musicaux, séparés par des virgules" value={draft.genres} onChange={v => change('genres', v)} disabled={busy} />
      <Action title="Enregistrer mon profil" disabled={busy} onPress={() => void run(async () => {
        const updated = await client.updateMyProfile(profile, draft);
        if (alive.current) { setProfile(updated); setDraft(null); setNotice('Profil enregistré.'); }
      })} />
      <Action title="Annuler" secondary disabled={busy} onPress={() => { setDraft(null); setError(''); }} />
    </> : <>
      {profile ? <>
        <Text style={styles.title}>{profile.name}</Text>
        <Text style={styles.text}>{profile.email} · visible uniquement par toi</Text>
        <Info title="Informations publiques · tout le monde" info={profile.publicInfo} />
        <Info title="Informations pour mes amis" info={profile.friendsOnlyInfo} />
        <Info title="Informations privées · moi uniquement" info={profile.privateInfo} />
        <Text style={styles.label}>Mes genres musicaux · publics</Text>
        <Text style={styles.text}>{profile.musicPreferences.join(', ') || 'Aucun genre ajouté.'}</Text>
        <Text style={styles.label}>Connexion Google</Text>
        {profile.googleId ? <Text style={styles.text}>Compte Google lié.</Text> :
          <Action title="Lier Google" secondary disabled={busy} onPress={linkGoogle} />}
        <Action title="Modifier mon profil" disabled={busy} onPress={() => { setDraft(profileDraft(profile)); setNotice(''); }} />
      </> : null}
      <Action title={profile ? 'Actualiser mon profil' : 'Réessayer'} secondary disabled={busy}
        onPress={() => void run(async () => { const p = await client.getMyProfile(); if (alive.current) setProfile(p); })} />
    </>}
  </View>;
}
