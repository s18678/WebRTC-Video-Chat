# This is readme attached to project i used as baseline

# WebRTC Video Chat

A React Native application for video chat using WebRTC technology.

## Prerequisites

- Node.js (v14 or higher)
- React Native development environment set up
- Android Studio (for Android development)
- Xcode (for iOS development, macOS only)
- Physical device or emulator with camera and microphone

## Required Permissions

### Android

The app requires the following permissions:

- Camera
- Microphone
- Internet
- Network State
- Bluetooth (for audio routing)
- Local Network

### iOS

The app requires the following permissions:

- Camera
- Microphone
- Local Network

## Getting Started

1. **Clone the repository:**

   ```sh
   git clone [your-repo-url]
   cd WebRTCPracticeNative
   ```

2. **Install dependencies:**

   ```sh
   npm install
   ```

3. **Set up environment variables:**

   - Create a `.env` file in the root directory:
     ```
     SERVER_IP=your_local_ip
     SERVER_PORT=8888
     ```
   - Create a `.env` file in the server directory:
     ```
     PORT=8888
     ```

4. **Start the server:**

   ```sh
   cd server
   npm install
   node server.js
   ```

5. **Start the Metro bundler:**

   ```sh
   npm start
   ```

6. **Run the app:**
   - For Android:
     ```sh
     npm run android
     ```
   - For iOS:
     ```sh
     npm run ios
     ```

## Running on a Real Device

### Prerequisites

- Ensure your device and computer are on the same network
- For Android, enable USB debugging in Developer Options
- For iOS, ensure you have the correct permissions

### Steps to Run on a Real Device

1. **Start the Metro Bundler:**

   ```sh
   npm start
   ```

2. **Run the app on your device:**

   - **Android:**
     ```sh
     npm run android
     ```
   - **iOS:**
     ```sh
     npm run ios
     ```

3. **Open the Developer Menu on your device:**

   - **Android:** Shake the device or run:
     ```sh
     adb shell input keyevent 82
     ```
   - **iOS:** Shake the device or press `Cmd + D` (if connected to a Mac)

4. **Ensure the server is running:**

   - Navigate to the server directory:
     ```sh
     cd server
     ```
   - Install dependencies if not already done:
     ```sh
     npm install
     ```
   - Start the server:
     ```sh
     node server.js
     ```

5. **Check the server IP address:**

   - Ensure the IP address in `.env` matches your computer's local IP
   - Update the IP if necessary and restart the Metro bundler and server

6. **Troubleshooting:**
   - If the app fails to connect to the server, ensure both the device and computer are on the same network
   - Check for any firewall issues blocking port 8080
   - Verify the server is running and accessible from the device's browser
   - Ensure all required permissions are granted on the device

## Features

- Real-time video and audio communication
- Camera and microphone access
- Local network WebRTC connections
- Cross-platform support (Android and iOS)

## Dependencies

- react-native-webrtc
- socket.io-client
- react-native-dotenv
- express (server)
- socket.io (server)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
