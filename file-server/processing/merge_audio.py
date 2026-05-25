import os
import asyncio
from pydub import AudioSegment
import json
import aiofiles
import imageio_ffmpeg as ffmpeg
from collections import defaultdict
from datetime import datetime

AudioSegment.converter = ffmpeg.get_ffmpeg_exe()

# Helper function to load JSON asynchronously
async def load_json(file_path):
    async with aiofiles.open(file_path, 'r') as f:
        content = await f.read()
        return json.loads(content)

async def merge_audio_files(session_dir): 
    # This check is reduntant if called from server, included for manual testing
    if not os.path.exists(session_dir):
        raise FileNotFoundError(f"Session directory {session_dir} does not exist.")
    # File pattern: <session_dir>/<participant_id>_<timestamp>_meta.json and <session_dir>/<participant_id>_<timestamp>_audio.mp4
    # Timestamp in filename is unreliable, it's added to ensure uniqueness only (in case of multiple recordings from same participant)
    metadata_files = [f for f in os.listdir(session_dir) if f.endswith('meta.json')]
    if not metadata_files:
        raise ValueError("No metadata files found in the session directory.")
    
    tasks = [load_json(os.path.join(session_dir, file)) for file in metadata_files]
    try:
        metadata = await asyncio.gather(*tasks)
    except Exception as e:
        raise ValueError(f"Error loading metadata files: {e}")
    
    if not metadata:
        raise ValueError("Failed to obtain any metadata from files.")
    
    # Session start time
    timestamp_zero = min((meta['audioStartTimestamp'] for meta in metadata), default=0)
    
    session_id = metadata[0].get('sessionId', 'unknown_session')
    
    # Preset merged audio duration using the latest audioEndTimestamp
    max_end_timestamp = max(meta['audioEndTimestamp'] for meta in metadata)
    total_duration = max_end_timestamp - timestamp_zero
    merged_audio = AudioSegment.silent(duration=total_duration)
    
    # Group metadata by participantId for multichannel export
    participant_segments = defaultdict(list)
    for data in metadata:
        participant_segments[data['participantId']].append(data)
    
    audio_segments = []
    
    # Create one channel per participant
    for participant_id, participant_data in participant_segments.items():
        # Create silent track for this participant
        participant_audio = AudioSegment.silent(duration=total_duration)
        
        for data in participant_data:
            audio_file_path = os.path.join(session_dir, data['audioFile'])
            if not os.path.exists(audio_file_path):
                print(f"Warning: Audio file {audio_file_path} not found, skipping.")
                continue
            
            audio_segment = AudioSegment.from_file(audio_file_path, format="mp4")
            # Relativize timestamp of user joining the session
            segment_start = data['audioStartTimestamp'] - timestamp_zero
            
            # Overlay this segment at its position for this participant's channel
            participant_audio = participant_audio.overlay(audio_segment, position=segment_start)
            
            # Also overlay to the mixed audio
            merged_audio = merged_audio.overlay(audio_segment, position=segment_start)
        
        audio_segments.append(participant_audio)
        
    filename = f"{metadata[0].get('roomId', 'unknown_room')}_{datetime.fromtimestamp(timestamp_zero/1000).strftime('%Y-%m-%d_%H-%M-%S')}_{session_id}_merged"
    # Export mixed audio as MP3
    output_mp3_path = os.path.join(session_dir, filename + '.mp3')
    merged_audio.export(output_mp3_path, format="mp3")
    print(f"Merged audio saved to {output_mp3_path}")
    
    # Export multichannel audio as WAV
    if audio_segments:
        merged_multichannel = AudioSegment.from_mono_audiosegments(*audio_segments)
        output_wav_path = os.path.join(session_dir, filename + '.wav')
        merged_multichannel.export(output_wav_path, format="wav")
        print(f"Multichannel audio saved to {output_wav_path}")
        
    os.rename(session_dir, os.path.join(os.path.dirname(session_dir), filename))
    print(f"Session directory renamed to {filename}")
    
if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python merge_audio.py <session_directory>")
        sys.exit(1)
    
    session_directory = sys.argv[1]
    asyncio.run(merge_audio_files(session_directory))
