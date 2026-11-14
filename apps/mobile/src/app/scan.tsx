import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { emitBarcode } from '@/lib/scanBus';

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  if (!permission) return <View style={styles.fill} />;

  if (!permission.granted) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={styles.text}>Camera access is needed to scan barcodes.</Text>
        <Button title="Allow camera" onPress={requestPermission} />
        <Button title="Cancel" variant="outline" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          handled.current = true;
          router.back();
          emitBarcode(data);
        }}
      />
      <View style={styles.frame} pointerEvents="none" />
      <View style={styles.bottom}>
        <Text style={styles.text}>Point at a barcode</Text>
        <Button title="Cancel" variant="outline" color="#fff" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  text: { color: '#fff', fontSize: 16, textAlign: 'center' },
  frame: {
    position: 'absolute',
    top: '35%',
    left: '10%',
    right: '10%',
    height: 160,
    borderColor: '#fff',
    borderWidth: 2,
    borderRadius: 16,
  },
  bottom: { position: 'absolute', bottom: 60, left: 24, right: 24, gap: 16 },
});
