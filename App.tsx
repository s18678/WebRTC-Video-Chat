import React, {useEffect, useRef, useState} from 'react';
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  PermissionsAndroid,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import {
  RTCPeerConnection,
  mediaDevices,
  RTCView,
  MediaStream,
} from 'react-native-webrtc';
import Sound from 'react-native-nitro-sound';
import io from 'socket.io-client';
import RNFS from 'react-native-fs';
import RNFetchBlob from 'rn-fetch-blob';
import {SERVER_ADDRESS, FILE_SERVER_ADDRESS, DEFAULT_ROOM_ID} from '@env';

const configuration = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
};

type SignalingPayload = {
  from: string;
  target?: string;
  room?: string;
  offer?: any;
  answer?: any;
  candidate?: any;
};

const App = () => {
  const [roomId, setRoomId] = useState<string>(DEFAULT_ROOM_ID || '');
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>(
    {},
  );
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAudioRecording, setIsAudioRecording] = useState(false);
  const [audioStartTimestamp, setAudioStartTimestamp] = useState<number | null>(
    null,
  );
  const [isUploading, setIsUploading] = useState(false);

  const socketRef = useRef<any>(null);
  const roomIdRef = useRef(roomId);
  const participantIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const isConnectedRef = useRef(false);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  const getSynchronizedServerTime = async (): Promise<number> => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      throw new Error('Socket not connected');
    }

    return new Promise<number>((resolve, reject) => {
      const start = Date.now();
      const timeout = setTimeout(() => {
        reject(new Error('Server time request timeout'));
      }, 5000);

      try {
        socket.emit('get-server-time', null, (serverTime: number) => {
          clearTimeout(timeout);
          const end = Date.now();
          const rtt = end - start;
          const serverTimeAdjusted = serverTime + Math.floor(rtt / 2);
          const appTimeDivergence = end - serverTimeAdjusted;
          resolve(appTimeDivergence);
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  };

  const startAudioRecording = async () => {
    if (!isAudioRecording) {
      try {
        setTimeout(async () => {
          try {
            await Sound.startRecorder();
            const recordingStart = Date.now();
            const serverTimestamp =
              recordingStart - (await getSynchronizedServerTime());
            setAudioStartTimestamp(serverTimestamp);
            setIsAudioRecording(true);
            console.log('Started recording audio at', serverTimestamp);
          } catch (err) {
            console.error('Error starting recording', err);
          }
        }, 0);
      } catch (error_) {
        console.error('Error starting recording', error_);
      }
    }
  };

  const stopAudioRecording = async () => {
    if (isAudioRecording) {
      try {
        const result = await Sound.stopRecorder();
        const recordingEnd = Date.now();
        const serverTimestamp = recordingEnd - (await getSynchronizedServerTime());
        Sound.removeRecordBackListener();
        setIsAudioRecording(false);
        console.log(
          `Stopped recording audio at ${serverTimestamp}. File saved at: ${result}`,
        );
        saveRecordingFile(result, serverTimestamp);
      } catch (error_) {
        console.error('Error stopping recording', error_);
      }
    }
  };

  const saveRecordingFile = async (audioPath: string, endTimestamp: number) => {
    console.log('Saving recording file...');
    try {
      if (audioPath && sessionId && audioStartTimestamp) {
        const dir = RNFS.ExternalDirectoryPath + '/WebRtcVCAppRecordings';
        const fileSuffix = Date.now();
        const audioDest = `${dir}/${sessionId}_${participantId}_${fileSuffix}_audio.mp4`;
        const exists = await RNFS.exists(dir);
        if (!exists) {
          await RNFS.mkdir(dir);
        }
        await RNFS.moveFile(audioPath, audioDest);
        const metadata = {
          sessionId: sessionId,
          roomId: roomIdRef.current,
          participantId: participantId,
          audioFile: audioDest.split('/').pop(),
          audioStartTimestamp,
          audioEndTimestamp: endTimestamp,
        };
        const metadataPath = `${dir}/${sessionId}_${participantId}_${fileSuffix}_meta.json`;
        await RNFS.writeFile(metadataPath, JSON.stringify(metadata), 'utf8');
        console.log('Saved metadata:', metadata);

        const newMetadata = {
          ...metadata,
          audioMd5: await RNFS.hash(audioDest, 'md5'),
        };
        await RNFS.writeFile(metadataPath, JSON.stringify(newMetadata), 'utf8');
        console.log('Updated metadata with MD5:', newMetadata);

        await uploadFile(metadataPath);
        await uploadFile(audioDest);
        await RNFS.unlink(audioDest);
        console.log('Deleted local audio file:', audioDest);
      }
    } catch (error_) {
      console.error('Error saving recording file', error_);
      throw error_;
    }
  };

  const uploadFile = async (filePath: string) => {
    const fileName = filePath.split('/').pop();
    const mimeType =
      (fileName?.endsWith('.mp4') && 'video/mp4') ||
      (fileName?.endsWith('.json') && 'application/json') ||
      'application/octet-stream';

    const timeoutMs = 5000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const resetTimeout = (reject: (reason?: any) => void) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      timeoutHandle = setTimeout(
        () => reject(new Error('Upload timed out')),
        timeoutMs,
      );
    };

    setIsUploading(true);
    try {
      const res = await new Promise<any>((resolve, reject) => {
        const request = RNFetchBlob.fetch(
          'POST',
          `${FILE_SERVER_ADDRESS}/upload`,
          {
            'Content-Type': 'multipart/form-data',
          },
          [
            {
              name: 'file',
              filename: fileName,
              type: mimeType,
              data: RNFetchBlob.wrap(filePath),
            },
          ],
        );

        resetTimeout(reject);
        request.uploadProgress({interval: 250}, () => {
          resetTimeout(reject);
        });

        request
          .then(resp => {
            resolve(resp);
          })
          .catch(err => {
            reject(err);
          });
      });

      return res.json();
    } catch (err) {
      console.error('Error uploading file:', fileName, err);
      throw err;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      setIsUploading(false);
    }
  };

  const requestPermissions = async () => {
    try {
      const cameraStatus = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.CAMERA,
      );
      const audioStatus = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );

      if (!cameraStatus || !audioStatus) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);
        if (
          granted['android.permission.CAMERA'] !==
            PermissionsAndroid.RESULTS.GRANTED ||
          granted['android.permission.RECORD_AUDIO'] !==
            PermissionsAndroid.RESULTS.GRANTED
        ) {
          Alert.alert(
            'Permissions Required',
            'Camera and microphone permissions are required to make video calls.',
            [{text: 'OK'}],
          );
          return false;
        }
      }
      return true;
    } catch (err) {
      console.warn(err);
      return false;
    }
  };

  const ensureLocalMedia = async (): Promise<MediaStream> => {
    let stream = localStreamRef.current;
    if (!stream) {
      const hasPermissions = await requestPermissions();
      if (!hasPermissions) {
        throw new Error('Permissions not granted');
      }

      stream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          height: {min: 640, ideal: 1280, max: 1920},
          width: {min: 480, ideal: 720, max: 1080},
          frameRate: {min: 15, ideal: 30, max: 60},
          facingMode: 'user',
        },
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
    }

    return stream;
  };

  const removeRemoteParticipant = (remoteParticipantId: string) => {
    const pc = peerConnectionsRef.current[remoteParticipantId];
    if (pc) {
      const pcAny = pc as any;
      try {
        pcAny.onicecandidate = null;
        pcAny.ontrack = null;
        pc.close();
      } catch (err) {
        console.error('Error closing peer connection:', err);
      }
      delete peerConnectionsRef.current[remoteParticipantId];
    }

    setRemoteStreams(prev => {
      const next = {...prev};
      delete next[remoteParticipantId];
      return next;
    });
  };

  const createPeerConnection = async (
    remoteParticipantId: string,
  ): Promise<RTCPeerConnection> => {
    const existing = peerConnectionsRef.current[remoteParticipantId];
    if (existing) {
      return existing;
    }

    const pc = new RTCPeerConnection(configuration);
    peerConnectionsRef.current[remoteParticipantId] = pc;

    (pc as any).ontrack = (event: any) => {
      const stream = event?.streams?.[0];
      if (!stream) {
        return;
      }
      setRemoteStreams(prev => ({
        ...prev,
        [remoteParticipantId]: stream,
      }));
    };

    (pc as any).onicecandidate = (event: any) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          room: roomIdRef.current,
          target: remoteParticipantId,
        });
      }
    };

    (pc as any).onconnectionstatechange = () => {
      if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed' ||
        pc.connectionState === 'disconnected'
      ) {
        removeRemoteParticipant(remoteParticipantId);
      }
    };

    const stream = await ensureLocalMedia();
    const senderTrackIds = new Set(
      pc.getSenders().map(sender => sender.track?.id),
    );
    stream.getTracks().forEach(track => {
      if (!senderTrackIds.has(track.id)) {
        pc.addTrack(track, stream);
      }
    });

    return pc;
  };

  const createOfferForParticipant = async (remoteParticipantId: string) => {
    try {
      if (!socketRef.current || remoteParticipantId === participantIdRef.current) {
        return;
      }

      const pc = await createPeerConnection(remoteParticipantId);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);

      socketRef.current.emit('offer', {
        offer,
        room: roomIdRef.current,
        target: remoteParticipantId,
      });
    } catch (err) {
      console.error(`Error creating offer for ${remoteParticipantId}:`, err);
    }
  };

  const closeAllPeerConnections = () => {
    Object.keys(peerConnectionsRef.current).forEach(remoteParticipantId => {
      removeRemoteParticipant(remoteParticipantId);
    });
  };

  useEffect(() => {
    requestPermissions();
    console.log('Attempting to connect to:', SERVER_ADDRESS);

    const signalingSocket = io(SERVER_ADDRESS, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = signalingSocket;

    signalingSocket.on('connect', () => {
      console.log('Socket connected successfully');
      setError(null);
    });

    signalingSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    signalingSocket.on('connect_error', err => {
      console.error('Socket connection error:', err);
      setError(`Failed to connect to server: ${err.message || err}`);
    });

    signalingSocket.on('error', err => {
      console.error('Socket error:', err);
    });

    signalingSocket.on('participant-id', (id: string) => {
      participantIdRef.current = id;
      setParticipantId(id);
    });

    signalingSocket.on('session-id', (id: string) => {
      setSessionId(id);
    });

    signalingSocket.on('participant-joined', async ({participantId: newId}) => {
      if (!newId || !isConnectedRef.current) {
        return;
      }
      await createOfferForParticipant(newId);
    });

    signalingSocket.on('participant-left', ({participantId: leftId}) => {
      if (!leftId) {
        return;
      }
      removeRemoteParticipant(leftId);
    });

    signalingSocket.on('room-participants', (participants: string[]) => {
      console.log('Room participants:', participants);
    });

    signalingSocket.on('offer', async (data: SignalingPayload) => {
      try {
        if (!data?.from || data.from === participantIdRef.current) {
          return;
        }
        const pc = await createPeerConnection(data.from);
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        signalingSocket.emit('answer', {
          answer,
          room: roomIdRef.current,
          target: data.from,
        });
      } catch (err) {
        console.error('Error handling offer:', err);
      }
    });

    signalingSocket.on('answer', async (data: SignalingPayload) => {
      try {
        if (!data?.from) {
          return;
        }
        const pc = peerConnectionsRef.current[data.from];
        if (!pc) {
          return;
        }
        await pc.setRemoteDescription(data.answer);
      } catch (err) {
        console.error('Error setting remote description:', err);
      }
    });

    signalingSocket.on('ice-candidate', async (data: SignalingPayload) => {
      try {
        if (!data?.from || !data?.candidate) {
          return;
        }
        const pc = peerConnectionsRef.current[data.from];
        if (!pc) {
          return;
        }
        await pc.addIceCandidate(data.candidate);
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    return () => {
      closeAllPeerConnections();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      signalingSocket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCall = async () => {
    try {
      setError(null);

      if (!socketRef.current) {
        throw new Error('Socket not initialized');
      }

      await ensureLocalMedia();
      socketRef.current.emit('join-room', roomIdRef.current);
      setIsConnected(true);
      await startAudioRecording();
    } catch (error_) {
      console.error('Error in startCall:', error_);
      setError(
        error_ instanceof Error ? error_.message : 'Failed to start call',
      );
      setIsConnected(false);
    }
  };

  const endCall = async () => {
    try {
      closeAllPeerConnections();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }

      if (isAudioRecording) {
        await stopAudioRecording();
      }

      setAudioStartTimestamp(null);
      setLocalStream(null);
      setRemoteStreams({});

      if (socketRef.current && roomIdRef.current) {
        socketRef.current.emit('leave-room', roomIdRef.current);
      }

      setIsConnected(false);
      setError(null);
    } catch (error_) {
      console.error('Error in endCall:', error_);
      setError('Failed to end call properly');
    }
  };

  const remoteStreamEntries = Object.entries(remoteStreams);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.videoContainer}>
        {localStream?.toURL() && (
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.videoStream}
            objectFit="cover"
          />
        )}
        {remoteStreamEntries.map(([id, stream]) => (
          <RTCView
            key={id}
            streamURL={stream.toURL()}
            style={styles.videoStream}
            objectFit="cover"
          />
        ))}
      </ScrollView>
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <KeyboardAvoidingView behavior="padding">
        <TextInput
          id="roomIdInput"
          style={styles.input}
          onChangeText={text => setRoomId(text)}
          value={roomId}
          editable={!isConnected}
          placeholder="Enter Room ID"
          textAlign="center"
        />
      </KeyboardAvoidingView>
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[
            styles.button,
            isConnected ? styles.buttonEnd : styles.buttonStart,
            ((isUploading && !isConnected) || !roomId) && styles.buttonDisabled,
          ]}
          onPress={isConnected ? endCall : startCall}
          disabled={(isUploading && !isConnected) || !roomId}>
          <Text style={styles.buttonText}>
            {(isUploading && !isConnected && 'Uploading...') ||
              (isConnected && 'End Call') ||
              'Start Call'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#383838',
  },
  videoContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  videoStream: {
    width: '45%',
    height: 200,
    margin: 5,
    backgroundColor: '#E0E0E0',
    borderRadius: 10,
  },
  buttonContainer: {
    padding: 20,
    alignItems: 'center',
  },
  button: {
    padding: 15,
    borderRadius: 25,
    width: 200,
    alignItems: 'center',
  },
  buttonStart: {
    backgroundColor: '#4CAF50',
  },
  buttonEnd: {
    backgroundColor: '#F44336',
  },
  buttonDisabled: {
    backgroundColor: '#9E9E9E',
    opacity: 0.6,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorContainer: {
    padding: 10,
    margin: 10,
    backgroundColor: '#FFEBEE',
    borderRadius: 5,
  },
  errorText: {
    color: '#D32F2F',
    textAlign: 'center',
  },
  input: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    margin: 10,
    paddingLeft: 10,
    borderRadius: 5,
    backgroundColor: 'white',
    color: 'black',
  },
});

export default App;
