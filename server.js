const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const dotenv = require("dotenv");

dotenv.config();
const TRANSCRIPTION_LANGUAGES = [
  {'Chinese (Mandarin, Simplified)':{'model-suffix':'zh', 'port':3003}},
  {'English': {'model-suffix':'en', 'port':3004}},
  {'French': {'model-suffix':'fr', 'port':3005}},
  {'German': {'model-suffix':'de', 'port':3006}},
  {'Multilingual (Spanish + English)': {'model-suffix':'multi', 'port':3007}}
]
let keepAlive;

const createStableClient = () => {
  try {
    return createClient(process.env.DEEPGRAM_API_KEY);
  } catch (e) {
    console.error('Error fetching user usage details:', e);
    return createClient(process.env.DEEPGRAM_API_KEY2);
  }
};

const setupDeepgram = (ws, language, modelSuffix) => {
  console.log(`Deepgram: Setting up for language ${language} and modelSuffix ${modelSuffix}`);
  const deepgram = createStableClient().listen.live({
    language: modelSuffix,
    punctuate: true,
    smart_format: true,
    model: "nova-2",
    diarize: true,
  });


  const startKeepAlive = () => {
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = setInterval(() => {
      if (deepgram.getReadyState() === 1) {
        console.log("Deepgram: Keeping connection alive");
        deepgram.keepAlive();
      }
    }, 5000); // Increased interval to 5 seconds to reduce unnecessary calls
  };

  deepgram.addListener(LiveTranscriptionEvents.Open, () => {
    console.log("Deepgram: Connected");
    startKeepAlive();

    deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
      console.log("Deepgram: Transcript received");
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    });

    deepgram.addListener(LiveTranscriptionEvents.Close, () => {
      console.log("Deepgram: Disconnected");
      clearInterval(keepAlive);
    });

    deepgram.addListener(LiveTranscriptionEvents.Error, (error) => {
      console.error("Deepgram: Error received", error);
      clearInterval(keepAlive);
      deepgram.finish();
    });

    deepgram.addListener(LiveTranscriptionEvents.Warning, (warning) => {
      console.warn("Deepgram: Warning received", warning);
    });

    deepgram.addListener(LiveTranscriptionEvents.Metadata, (data) => {
      console.log(`Deepgram: Metadata received for ${language} ${JSON.stringify(data)}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ metadata: data }));
      }
    });
  }); 

  return deepgram;
};

const servers = TRANSCRIPTION_LANGUAGES.map(languageObj => {
  const language = Object.keys(languageObj)[0];
  const { 'model-suffix': modelSuffix, port } = languageObj[language];

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  wss.on("connection", (ws) => {
    console.log(`Socket: Client connected on port ${port}`);
    let deepgram = setupDeepgram(ws, language.toLowerCase(), modelSuffix);
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 50000;
  
    const reconnectToDeepgram = () => {
      if (reconnectAttempts < maxReconnectAttempts) {
        console.log(`Socket: Retrying connection to Deepgram ${language.toLowerCase()}(Attempt ${reconnectAttempts + 1})`);
        deepgram = setupDeepgram(ws, language.toLowerCase(), modelSuffix);
        reconnectAttempts++;
        return deepgram.getReadyState() === 1;
      }
      console.log(`Socket: Max reconnection attempts reached ${language.toLowerCase()}`);
      return false;
    };
  
    ws.on("message", (message) => {
      console.log("Deepgram state is", deepgram.getReadyState());
      console.log(`Socket: Client data received ${language.toLowerCase()}`);
      

      if (deepgram.getReadyState() === 1) {
        console.log(`Socket: Data sent to Deepgram ${language.toLowerCase()}`);
        deepgram.send(message);
        reconnectAttempts = 0; // Reset reconnect attempts on successful send
      } else if (reconnectToDeepgram()) {
        deepgram.send(message);
        console.log(`Socket: Data sent to Deepgram after reconnection ${language.toLowerCase()}`);
      } else {
        console.log(`Socket: Data couldn't be sent to Deepgram, ${language.toLowerCase()}`);
        console.log(deepgram)
      }
    }); 

    ws.on("error", (error) => {
      console.error("Socket: Error", error);
      ws.close();
    });

    ws.on("close", () => {
      console.log(`Socket: Client disconnected for language ${language}`);
      clearInterval(keepAlive);
      try {
        if (deepgram) {
          deepgram.finish();
          deepgram.removeAllListeners();
        }
      } catch (error) {
        console.error(" ${language} Error during cleanup:", error);
      }
    });

  });

  app.use(express.static("public/"));

  app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/index.html");
  });

  return { server, port, language };
});

servers.forEach(({ server, port, language }) => {
  server.listen(port, () => {
    console.log(`Server for ${language} is listening on port ${port}`);
  });
});