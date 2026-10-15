import { Redirect } from 'expo-router';

// 동맹은 매칭 탭의 '동맹' 칸으로 옮겼다. 예전 주소·알림으로 들어와도 그곳으로 보낸다
export default function AlliancesRedirect() {
  return <Redirect href={{ pathname: '/matching', params: { view: 'ally' } }} />;
}
