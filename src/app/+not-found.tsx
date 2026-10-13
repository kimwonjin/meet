import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

// 없는 주소로 들어온 경우
export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: '페이지를 찾을 수 없어요' }} />
      <View style={styles.container}>
        <Text style={styles.title}>페이지를 찾을 수 없어요</Text>
        <Text style={styles.body}>주소가 바뀌었거나 없는 페이지예요.</Text>
        <Link href="/" replace style={styles.button}>
          <Text style={styles.buttonText}>처음 화면으로</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#FFFFFF' },
  title: { fontSize: 18, fontWeight: '700', color: '#1C1A22', marginBottom: 8 },
  body: { fontSize: 14, color: '#65626B', marginBottom: 24 },
  button: { backgroundColor: '#5B21FF', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
