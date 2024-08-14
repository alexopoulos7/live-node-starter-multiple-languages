const TRANSCRIPTION_LANGUAGES = [
  {'Chinese (Mandarin, Simplified)':{'model-suffix':'zh', 'port':3003}},
  {'English': {'model-suffix':'en', 'port':3004}},
  {'French': {'model-suffix':'fr', 'port':3005}},
  {'German': {'model-suffix':'de', 'port':3006}},
  {'Multilingual (Spanish + English)': {'model-suffix':'multi', 'port':3007}}
]

const maxReconnectInterval = 30000; // Maximum 30 seconds between reconnects
const languageSelected = document.getElementById('listeningLanguage');
const maxReconnectAttempts = 100;

let sharedData = {
  sockets: [],
  current_socket: null,
  listening_language: null,
  seconds: 0,
  microphone: null
}

const captions = window.document.getElementById("captions");

async function getMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return new MediaRecorder(stream, { mimeType: "audio/webm" });
  } catch (error) {
    console.error("error accessing microphone:", error);
    throw error;
  }
}

async function openMicrophone(microphone) {
  console.log(`client: opening microphone ${microphone.stream.id}`);
  return new Promise((resolve) => {
    microphone.onstart = () => {
      console.log(`client: microphone ${microphone.stream.id} opened`);
      document.body.classList.add("recording");
      resolve();
    };

    microphone.onstop = () => {
      console.log(`client: microphone ${microphone.stream.id} closed`);
      document.body.classList.remove("recording");
    };

    microphone.ondataavailable = (event) => {
      console.log(`client: microphone ${microphone.stream.id} data received`);
      if (event.data.size > 0 && sharedData.current_socket.readyState === WebSocket.OPEN) {
        sharedData.current_socket.send(event.data);
      }
    };

    microphone.start(1000);
  });
}

async function closeMicrophone(microphone) {
  microphone.stop();
}

function populateLanguageDropdowns() {
  const listeningDropdown = document.getElementById('listeningLanguage');
  TRANSCRIPTION_LANGUAGES.forEach(lang => {
      const langName = Object.keys(lang)[0];
      const option = new Option(langName, langName);
      listeningDropdown.add(option.cloneNode(true));
  
      if (langName === 'English') {
        listeningDropdown.value = langName;
    }
  });
}


function getLanguageFromTranscriptionLanguages(language) {
  let languageObj = TRANSCRIPTION_LANGUAGES.find(obj => Object.keys(obj)[0].toLowerCase().startsWith(language.toLowerCase()));
  if (!languageObj) return null;
  let key = Object.keys(languageObj)[0];
  return languageObj[key];
}

async function start() {
  const listenButton = document.querySelector("#record");
  let microphone;

  console.log("client: waiting to open microphone");

  listenButton.addEventListener("click", async () => {
    if (!microphone) {
      try {
        connectWebSocket(languageSelected.value);
        microphone = await getMicrophone();
        await openMicrophone(microphone);
      } catch (error) {
        console.error("error opening microphone:", error);
      }
    } else {
      await closeMicrophone(microphone);
      microphone = undefined;
    }
  });
}


const connectWebSocket = (language_name) => { 
  let reconnectAttempts = 0;
  let reconnectInterval = 1000; // Initial reconnect interval
    
    const language = getLanguageFromTranscriptionLanguages(language_name);
 
    const current_socket = new WebSocket(`ws://localhost:${language.port}/`)
    sharedData.sockets.push(current_socket);
    console.log(`ws://localhost:${language.port}/`)

    current_socket.addEventListener("open", async (event) => {
      console.log("client: connected to server");
      console.log("client: waiting to open microphone");
      reconnectAttempts = 0; // Reset reconnect attempts on successful connection
    });

    current_socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data && data.channel && data.channel.alternatives[0].transcript !== "") {
        captions.innerHTML = `<span>${data.channel.alternatives[0].transcript}</span>`;
      } 
      
    });  

    current_socket.addEventListener("close", (e) => {
      console.log(e)
      console.log("client: disconnected from server");
     
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          reconnectInterval = Math.min(reconnectInterval * 2, maxReconnectInterval); // Exponential backoff
          setTimeout(() => {
            console.log(`client: attempting to reconnect (attempt ${reconnectAttempts})...`);
            //connectWebSocket();
          }, reconnectInterval);
        } else {
          console.error("client: maximum reconnect attempts reached");
        } 
    });
  
    current_socket.addEventListener("error", (error) => {
      console.error('WebSocket Error: ', error);
      showError(error_message, "Connection to the server failed. Please try again later.");
      current_socket.close(); // Close the socket to trigger reconnect logic
    }); 
  
  sharedData.current_socket = sharedData.sockets.slice(-1)[0];
  sharedData.listening_language = document.getElementById('listeningLanguage').value || 'English';
  let currentLanguageIndex = TRANSCRIPTION_LANGUAGES.findIndex(languageObj => Object.keys(languageObj)[0] === sharedData.listening_language);
  //sharedData.current_socket = sharedData.sockets[currentLanguageIndex];
   
}

async function updateListeningLanguage() {
  sharedData.listening_language = languageSelected.value;
  const language_index = TRANSCRIPTION_LANGUAGES.findIndex(lang => Object.keys(lang)[0] === sharedData.listening_language);
  console.log('Updated listening language:', sharedData.listening_language);
  connectWebSocket(sharedData.listening_language);
  
  // Stop current microphone and socket
  // if (sharedData.microphone) {
  //   await closeMicrophone(sharedData.microphone);
  //   sharedData.microphone = null;
  // }
  
  // Set the new socket
  sharedData.current_socket = sharedData.sockets.slice(-1)[0];
  
  // Restart the microphone with the new socket
  //sharedData.microphone = await getMicrophone();
  //await openMicrophone(sharedData.microphone);
}

window.addEventListener("load", () => {
  populateLanguageDropdowns();
  languageSelected.addEventListener('change', updateListeningLanguage);
  
  start()
});
