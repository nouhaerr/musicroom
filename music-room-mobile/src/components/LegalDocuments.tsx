import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export type LegalDocument = 'terms' | 'privacy';

// Local test-version text. Complete the marked operational details before release.
// The privacy content follows sonora-legal/privacy-policy.html, with native Google added.
const documents = {
  "terms": {
    "title": "Terms of Service",
    "sections": [
      [
        "Test version",
        "Sonora is a music-sharing project under development. Features may change or be unavailable. These terms describe the test version; final terms must be completed before public release."
      ],
      [
        "Your account",
        "Use an account you own and keep your password confidential. Link Google or Facebook explicitly from your signed-in Sonora account."
      ],
      [
        "Respect others",
        "Do not impersonate others, harass anyone, share unlawful content or try to access other users’ accounts or private information."
      ],
      [
        "Shared information",
        "Your name, public information and musical genres are visible to other users. Friends-only information is shared with accepted friends; your private section is visible only to you."
      ],
      [
        "Questions",
        "Project contact: grpsonora.music@gmail.com. The responsible party’s full identity and the terms for public release still need to be completed."
      ]
    ]
  },
  "privacy": {
    "title": "Privacy Policy",
    "sections": [
      [
        "Responsibility and contact",
        "Project contact: grpsonora.music@gmail.com. Before publication, complete the name and contact details of the responsible person or organization."
      ],
      [
        "Data used",
        "Sonora processes account and profile information, musical preferences, friendships and, depending on the features used, invitations, playlists and party participation. Platform, device, app version and action information support app operation and session monitoring."
      ],
      [
        "Google and Facebook sign-in",
        "Sonora receives a provider token to verify your identity, name and email when available and authorized. Sonora does not receive your Google or Facebook password."
      ],
      [
        "Use and visibility",
        "This data is used to create your account, authenticate you and provide Sonora features. Your name, public information and musical genres are visible to other users. Friends-only information is available to accepted friends. Your email and private section are not displayed on profiles viewed by other users."
      ],
      [
        "Storage on your phone",
        "The app stores the session refresh token in secure device storage, along with the server address and device reference. It does not store your password."
      ],
      [
        "Hosting and retention",
        "Before publication, complete the actual hosting providers and service providers, relevant countries, retention periods for accounts, logs and backups, and deletion procedures and timelines."
      ],
      [
        "Data requests",
        "Contact grpsonora.music@gmail.com to request access, correction or deletion of your data. Identity verification may be required to protect your account. The operational procedure must be confirmed before publication."
      ]
    ]
  }
};

export function LegalDocuments({ document, onClose }: { document: LegalDocument | null; onClose: () => void }) {
  if (!document) return null;
  const content = documents[document];
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>{content.title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close document" onPress={onClose} style={styles.close}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.draft}>Test version · Draft to be completed before publication.</Text>
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
