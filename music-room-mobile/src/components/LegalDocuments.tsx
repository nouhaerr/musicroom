import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export type LegalDocument = 'terms' | 'privacy';

// Local test-version text. Complete the marked operational details before release.
// The privacy content follows sonora-legal/privacy-policy.html, with native Google added.
const documents = {
  terms: {
    title: 'Conditions d’utilisation',
    sections: [
      ['Version de test', 'Sonora est un projet de partage musical en cours de développement. Certaines fonctionnalités peuvent être indisponibles ou évoluer. Ce texte présente les règles de la version de test ; les conditions définitives restent à finaliser avant une ouverture au public.'],
      ['Votre compte', 'Utilisez un compte qui vous appartient et gardez votre mot de passe confidentiel. La liaison à un compte Google se fait explicitement depuis votre compte Sonora connecté.'],
      ['Respect des autres', 'N’utilisez pas Sonora pour usurper une identité, harceler une personne, diffuser du contenu illicite ou tenter d’accéder aux comptes et aux informations privées des autres utilisateurs.'],
      ['Informations partagées', 'Votre nom, vos informations publiques et vos genres musicaux sont visibles par les autres utilisateurs. Les informations réservées aux amis sont partagées avec vos amis acceptés ; votre section privée est visible uniquement par vous.'],
      ['Questions', 'Contact du projet : grpsonora.music@gmail.com. L’identité complète du responsable et les conditions applicables à la version publique restent à compléter.'],
    ],
  },
  privacy: {
    title: 'Politique de confidentialité',
    sections: [
      ['Responsable et contact', 'Contact du projet : grpsonora.music@gmail.com. À compléter avant publication : nom et coordonnées de la personne ou de l’organisation responsable.'],
      ['Données utilisées', 'Sonora traite les informations de compte et de profil, les préférences musicales, les relations d’amitié et, selon les fonctionnalités utilisées, les invitations, playlists et participations aux soirées. Des informations sur la plateforme, l’appareil, la version de l’application et les actions servent au fonctionnement et au suivi des connexions.'],
      ['Connexion Google et Facebook', 'La connexion Google transmet à Sonora un jeton d’identité permettant au serveur de vérifier votre identifiant, votre nom et votre email. Le backend prend aussi en charge Facebook et reçoit l’identifiant, le nom et l’email lorsqu’il est disponible et autorisé. Sonora ne reçoit pas votre mot de passe Google ou Facebook.'],
      ['Utilisation et visibilité', 'Ces données servent à créer votre compte, vous authentifier et fournir les fonctionnalités de Sonora. Votre nom, vos informations publiques et vos genres musicaux sont visibles par les autres utilisateurs. Les informations réservées aux amis sont accessibles aux amis acceptés. Votre email et votre section privée ne sont pas affichés dans les profils des autres utilisateurs.'],
      ['Stockage sur le téléphone', 'L’application conserve le jeton de renouvellement de session dans le stockage sécurisé du téléphone, ainsi que l’adresse du serveur et la référence de l’appareil. Elle n’y sauvegarde pas votre mot de passe.'],
      ['Hébergement et conservation', 'À compléter avant publication : hébergeurs et prestataires réellement utilisés, pays concernés, durées de conservation des comptes, journaux et sauvegardes, ainsi que la procédure et les délais de suppression.'],
      ['Demandes concernant vos données', 'Vous pouvez contacter grpsonora.music@gmail.com pour demander l’accès, la correction ou la suppression de vos données. Une vérification de votre identité peut être nécessaire pour protéger votre compte. La procédure opérationnelle doit être confirmée avant publication.'],
    ],
  },
};

export function LegalDocuments({ document, onClose }: { document: LegalDocument | null; onClose: () => void }) {
  if (!document) return null;
  const content = documents[document];
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>{content.title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer le document" onPress={onClose} style={styles.close}>
          <Text style={styles.closeText}>Fermer</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.draft}>Version de test · Brouillon à compléter avant publication.</Text>
        {content.sections.map(([title, text]) => <View key={title} style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
          <Text style={styles.text}>{text}</Text>
        </View>)}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#10141E' },
  header: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, color: '#F3F3E9', fontSize: 23, fontWeight: '700' },
  close: { padding: 12 }, closeText: { color: '#A9B6FF', fontWeight: '700' },
  body: { paddingHorizontal: 24, paddingBottom: 32, gap: 22 },
  draft: { color: '#D4F2B6', lineHeight: 23 }, section: { gap: 8 },
  heading: { color: '#F3F3E9', fontSize: 18, fontWeight: '700' },
  text: { color: '#B4BDCE', fontSize: 16, lineHeight: 25 },
});
