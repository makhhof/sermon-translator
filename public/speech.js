class SermonSpeechRecognizer {
    constructor() {
        this.recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        this.isListening = false;
        this.setupRecognizer();
        this.lastSentTime = 0;
        this.minSendInterval = 300; // ms
    }

    setupRecognizer() {
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            // Display interim results
            const interimResultDiv = document.getElementById('interim-result');
            if (interimResultDiv) {
                interimResultDiv.textContent = interimTranscript;
            }

            // Process final results
            if (finalTranscript) {
                const now = Date.now();
                if (now - this.lastSentTime > this.minSendInterval) {
                    this.sendToTranslator(finalTranscript);
                    this.lastSentTime = now;
                }
            }
        };

        this.recognition.onend = () => {
            if (this.isListening) {
                this.recognition.start(); // Auto-restart if still listening
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.stop();
        };
    }

    sendToTranslator(text) {
        fetch('/translate', {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: `text=${encodeURIComponent(text.trim())}`
        })
        .then(response => response.json())
        .then(data => {
            if (data.translation) {
                document.getElementById('farsi-translation').textContent = data.translation;
            }
        })
        .catch(error => console.error('Translation error:', error));
    }

    start() {
        if (this.isListening) return;
        
        this.isListening = true;
        document.getElementById('startBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
        document.getElementById('interim-result').textContent = 'Listening...';
        
        try {
            this.recognition.start();
        } catch (error) {
            console.error('Recognition start error:', error);
            this.isListening = false;
            document.getElementById('startBtn').disabled = false;
            document.getElementById('stopBtn').disabled = true;
        }
    }

    stop() {
        if (!this.isListening) return;
        
        this.isListening = false;
        this.recognition.stop();
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        document.getElementById('interim-result').textContent = '';
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    const recognizer = new SermonSpeechRecognizer();
    
    document.getElementById('startBtn').addEventListener('click', () => {
        recognizer.start();
    });
    
    document.getElementById('stopBtn').addEventListener('click', () => {
        recognizer.stop();
    });
});