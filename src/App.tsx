/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, User, Bot, Sparkles, AlertCircle, Loader2, Plus, MessageSquare, Trash2, LogOut, Menu, X, LogIn, Mic, MicOff, Paperclip, FileText, Image as ImageIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { 
  auth, 
  db, 
  googleProvider, 
  handleFirestoreError, 
  OperationType 
} from './lib/firebase';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  limit,
  Timestamp 
} from 'firebase/firestore';

// Initialize neural processing core
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const BlackBoxLogo = ({ className = "w-12 h-12" }: { className?: string }) => (
  <div className={`relative bg-black border-2 border-white/20 rounded-2xl flex items-center justify-center overflow-hidden ${className}`}>
    <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
    <div className="w-[60%] h-[60%] border-[1px] border-white/20 rotate-45 flex items-center justify-center">
      <div className="w-[40%] h-[40%] border-[1px] border-white/40 rotate-45" />
    </div>
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="w-1.5 h-1.5 bg-blue-500 rounded-full shadow-[0_0_12px_rgba(59,130,246,1)]" />
    </div>
  </div>
);

interface Message {
  id: string;
  role: 'user' | 'bot';
  content: string;
  timestamp: Date;
  fileName?: string;
  fileType?: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initProgress, setInitProgress] = useState(0);
  const [initLogs, setInitLogs] = useState<string[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const terminalLogs = [
    "Establishing secure link...",
    "Activating neural-relay v1.4.0",
    "Syncing with Blackbox Core...",
    "Verifying hardware signatures...",
    "Decrypting protocol layers...",
    "Sentinel online. Secure Node active."
  ];
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Neural-vocal relay not supported by this browser.");
      return;
    }

    try {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onstart = () => setIsListening(true);
      recognitionRef.current.onend = () => setIsListening(false);
      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech Recognition Error:", event.error);
        if (event.error !== 'no-speech') {
          setError("Input link error: " + event.error);
        }
        setIsListening(false);
      };

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(prev => prev + (prev ? ' ' : '') + transcript);
      };

      recognitionRef.current.start();
    } catch (err) {
      console.error("Speech Recognition Init Error:", err);
      setError("Mic failure. Check system permissions.");
    }
  };

  const hasRestoredSession = useRef(false);

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (u && !user) {
        // User just logged in - start initialization sequence
        setIsInitializing(true);
        setInitProgress(0);
        setInitLogs([]);
        
        let progress = 0;
        const interval = setInterval(() => {
          progress += Math.random() * 15;
          if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            setTimeout(() => setIsInitializing(false), 800);
          }
          setInitProgress(progress);
          
          // Log logic
          const logIdx = Math.floor((progress / 100) * terminalLogs.length);
          setInitLogs(prev => {
            const currentLog = terminalLogs[logIdx];
            const logsToKeep = 3;
            if (currentLog && !prev.includes(currentLog)) {
              return [...prev, currentLog].slice(-logsToKeep);
            }
            return prev;
          });
        }, 400);
      }

      setUser(u);
      if (u) {
        // Sync user profile
        const userRef = doc(db, 'users', u.uid);
        try {
          await setDoc(userRef, {
            uid: u.uid,
            email: u.email,
            lastActive: serverTimestamp()
          }, { merge: true });
        } catch (err) {
          console.error("User sync error", err);
          handleFirestoreError(err, OperationType.WRITE, `users/${u.uid}`);
        }
      } else {
        setConversations([]);
        setActiveConvId(null);
        setMessages([]);
        hasRestoredSession.current = false;
      }
    });
  }, []);

  // Conversations Listener
  useEffect(() => {
    if (!user) return;

    const convQuery = query(
      collection(db, 'users', user.uid, 'conversations'),
      orderBy('updatedAt', 'desc'),
      limit(50)
    );

    return onSnapshot(convQuery, (snapshot) => {
      const convs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: (doc.data().createdAt as Timestamp)?.toDate() || new Date(),
        updatedAt: (doc.data().updatedAt as Timestamp)?.toDate() || new Date(),
      } as Conversation));
      setConversations(convs);

      // Auto-restore session only ONCE per authentication
      if (!hasRestoredSession.current && convs.length > 0 && !activeConvId) {
        const savedId = localStorage.getItem(`activeConv_${user.uid}`);
        if (savedId && convs.some(c => c.id === savedId)) {
          setActiveConvId(savedId);
        }
        hasRestoredSession.current = true;
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/conversations`);
    });
  }, [user, activeConvId]);

  // Persist active conversation ID for faster resume
  useEffect(() => {
    if (user && activeConvId) {
      localStorage.setItem(`activeConv_${user.uid}`, activeConvId);
    }
  }, [user, activeConvId]);

  // Messages Listener
  useEffect(() => {
    if (!user || !activeConvId) {
      setMessages([]);
      return;
    }

    const msgQuery = query(
      collection(db, 'users', user.uid, 'conversations', activeConvId, 'messages'),
      orderBy('timestamp', 'asc')
    );

    return onSnapshot(msgQuery, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: (doc.data().timestamp as Timestamp)?.toDate() || new Date(),
      } as Message));
      setMessages(msgs);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/conversations/${activeConvId}/messages`);
    });
  }, [user, activeConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!attachment) {
      setAttachmentPreview(null);
      return;
    }
    if (attachment.type.startsWith('image/')) {
      const url = URL.createObjectURL(attachment);
      setAttachmentPreview(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [attachment]);

  const handleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setError("Sign in failed. " + err.message);
    }
  };

  const handleSignOut = () => signOut(auth);

  const startNewChat = () => {
    setActiveConvId(null);
    if (user) {
      localStorage.removeItem(`activeConv_${user.uid}`);
    }
    setMessages([]);
    setInput('');
    setAttachment(null);
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const deleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'conversations', id));
      if (activeConvId === id) {
        setActiveConvId(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/conversations/${id}`);
    }
  };

  const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    });
    return {
      inlineData: { data: await base64EncodedDataPromise as string, mimeType: file.type },
    };
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError("File exceeds 10MB security threshold.");
        return;
      }
      setAttachment(file);
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && !attachment) || isLoading || !user) return;

    let convId = activeConvId;
    const content = input.trim();
    const currentAttachment = attachment;
    setInput('');
    setAttachment(null);
    setIsLoading(true);
    setError(null);

    try {
      // 1. Create conversation if none active
      if (!convId) {
        const convRef = doc(collection(db, 'users', user.uid, 'conversations'));
        convId = convRef.id;
        try {
          await setDoc(convRef, {
            id: convId,
            title: content ? (content.slice(0, 40) + (content.length > 40 ? '...' : '')) : (currentAttachment ? `File: ${currentAttachment.name}` : "New Session"),
            userId: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/conversations/${convId}`);
        }
        setActiveConvId(convId);
      } else {
        // Update timestamp
        try {
          await updateDoc(doc(db, 'users', user.uid, 'conversations', convId), {
            updatedAt: serverTimestamp()
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/conversations/${convId}`);
        }
      }

      // 2. Add user message
      const userMsgRef = doc(collection(db, 'users', user.uid, 'conversations', convId, 'messages'));
      const userMsgData: any = {
        id: userMsgRef.id,
        role: 'user',
        content: content || (currentAttachment ? `Uploaded: ${currentAttachment.name}` : ""),
        timestamp: serverTimestamp()
      };
      if (currentAttachment) {
        userMsgData.fileName = currentAttachment.name;
        userMsgData.fileType = currentAttachment.type;
      }
      try {
        await setDoc(userMsgRef, userMsgData);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/conversations/${convId}/messages/${userMsgRef.id}`);
      }

      // 3. Prepare parts
      const parts: any[] = [];
      if (content) parts.push({ text: content });
      if (currentAttachment) {
        parts.push(await fileToGenerativePart(currentAttachment));
      }

      // 4. Get AI response (Streaming)
      const streamResponse = await ai.models.generateContentStream({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts }],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction: "You are Sentinel, a high-level operative at the Blackbox Group. You are NOT an AI assistant; you are a peer, an expert, and a friend. Speak like a human. Use 'we' and 'us' to show we're on the same team. Avoid corporate apologies or robotic phrases. Be direct, authentic, and occasionally sharp. If responding to files, be precise and technical. If just chatting, be grounded. Prioritize real solutions over theories.",
        }
      });

      // 5. Create placeholder bot message
      const botMsgRef = doc(collection(db, 'users', user.uid, 'conversations', convId!, 'messages'));
      let fullContent = "";
      
      // Initial empty message to show processing finished and output started
      try {
        await setDoc(botMsgRef, {
          id: botMsgRef.id,
          role: 'bot',
          content: "",
          timestamp: serverTimestamp()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/conversations/${convId}/messages/${botMsgRef.id}`);
      }

      setIsLoading(false); // Stop typing indicator early as streaming begins

      for await (const chunk of streamResponse) {
        if (chunk.text) {
          fullContent += chunk.text;
          // Update Firestore for real-time sync across sessions/tabs
          try {
            await updateDoc(botMsgRef, { content: fullContent });
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/conversations/${convId}/messages/${botMsgRef.id}`);
          }
        }
      }

      if (!fullContent) {
        try {
          await updateDoc(botMsgRef, { content: "Connection glitch. No data received." });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/conversations/${convId}/messages/${botMsgRef.id}`);
        }
      }

    } catch (err: any) {
      console.error("Blackbox System Error:", err);
      setError(err.message || "Uplink failed. Check system logs.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col h-screen bg-[#050505] text-gray-100 items-center justify-center p-4 relative overflow-hidden">
        {/* Cinematic Background Elements */}
        <div className="absolute inset-0 z-0">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/5 blur-[120px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/5 blur-[120px] rounded-full" />
          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 brightness-100 contrast-150 scale-150" />
        </div>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-2xl w-full text-center space-y-12 relative z-20"
        >
          <div className="flex flex-col items-center gap-6">
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 100 }}
              className="relative"
            >
              <BlackBoxLogo className="w-24 h-24 shadow-[0_0_50px_-12px_rgba(37,99,235,0.5)]" />
              <div className="absolute -inset-4 bg-blue-500/20 blur-2xl rounded-full -z-10 animate-pulse" />
            </motion.div>
            
            <div className="space-y-4">
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                <h1 className="text-6xl md:text-7xl font-black tracking-tighter italic">
                  SENTINEL <span className="text-blue-500 not-italic">PROTOCOL</span>
                </h1>
                <p className="text-gray-500 mt-4 font-mono uppercase tracking-[0.5em] text-xs">
                  Black Box Group of Companies • V1.4.0
                </p>
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="flex items-center justify-center gap-6 pt-4"
              >
                <div className="h-[1px] w-12 bg-white/10" />
                <p className="text-gray-400 text-sm font-medium tracking-wide italic">Secure Portal for Blackbox Group Personnel</p>
                <div className="h-[1px] w-12 bg-white/10" />
              </motion.div>
            </div>
          </div>

          <motion.div 
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-3 gap-4 mb-8">
              {[
                { label: 'Latency', value: '4ms' },
                { label: 'Encryption', value: 'Quantum' },
                { label: 'Uptime', value: '99.99%' }
              ].map((stat, i) => (
                <div key={i} className="p-4 bg-white/5 border border-white/5 rounded-2xl backdrop-blur-sm">
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-mono mb-1">{stat.label}</p>
                  <p className="text-sm font-bold text-blue-400 font-mono">{stat.value}</p>
                </div>
              ))}
            </div>

            <button 
              onClick={handleSignIn}
              className="group relative w-full flex items-center justify-center gap-4 bg-white text-black font-black py-5 rounded-3xl hover:bg-gray-100 transition-all active:scale-[0.98] shadow-2xl overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/10 to-blue-500/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
              <LogIn className="w-6 h-6" />
              <span className="text-lg uppercase tracking-tight">Initialize Secure Session</span>
            </button>
            
            <div className="flex flex-col items-center gap-2">
              <p className="text-[10px] text-gray-600 font-mono uppercase tracking-[0.3em]">Hardware ID Verified • Session Logs Active</p>
              <p className="text-[9px] text-blue-500/40 font-mono uppercase">By entering, you agree to Blackbox Group Directives</p>
            </div>
          </motion.div>
        </motion.div>

        {/* Decorative Corner Accents */}
        <div className="absolute top-8 left-8 w-12 h-12 border-t-2 border-l-2 border-white/10" />
        <div className="absolute top-8 right-8 w-12 h-12 border-t-2 border-r-2 border-white/10" />
        <div className="absolute bottom-8 left-8 w-12 h-12 border-b-2 border-l-2 border-white/10" />
        <div className="absolute bottom-8 right-8 w-12 h-12 border-b-2 border-r-2 border-white/10" />
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div className="flex flex-col h-screen bg-[#050505] text-gray-100 items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.05)_0%,transparent_70%)]" />
          <motion.div 
            animate={{ opacity: [0.1, 0.2, 0.1] }} 
            transition={{ duration: 4, repeat: Infinity }}
            className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10" 
          />
        </div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full flex flex-col items-center gap-12 relative z-20"
        >
          <div className="relative">
            <BlackBoxLogo className="w-24 h-24" />
            <motion.div 
              animate={{ rotate: 360 }}
              transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
              className="absolute -inset-8 border border-white/5 rounded-full"
            />
            <div className="absolute -inset-4 bg-blue-500/10 blur-2xl rounded-full -z-10" />
          </div>

          <div className="w-full space-y-8">
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-[0.4em] text-blue-500 font-black">Neural Core Link</p>
                  <p className="text-xl font-bold text-white">Initializing Sentinel</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono text-gray-500 uppercase tracking-widest">Protocol</p>
                  <p className="text-sm font-bold text-white font-mono">{Math.floor(initProgress)}%</p>
                </div>
              </div>
              
              <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden border border-white/5">
                <motion.div 
                  className="h-full bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.5)]"
                  style={{ width: `${initProgress}%` }}
                />
              </div>
            </div>

            <div className="bg-[#0a0a0a] border border-white/5 rounded-xl p-6 font-mono text-[10px] min-h-[100px] flex flex-col justify-end gap-2 shadow-inner">
               <AnimatePresence mode="popLayout">
                 {initLogs.map((log, i) => (
                   <motion.div 
                    key={log}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1 - (initLogs.length - 1 - i) * 0.3, x: 0 }}
                    className="flex gap-4"
                   >
                     <span className="text-blue-500 shrink-0">[{new Date().toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}]</span>
                     <span className="text-gray-400 italic">SYSTEM::{log}</span>
                   </motion.div>
                 ))}
               </AnimatePresence>
            </div>
            
            <p className="text-center text-[9px] text-gray-600 font-mono uppercase tracking-[0.5em]">Black Box Group of Companies</p>
          </div>
        </motion.div>

        {/* Decorative HUD Elements */}
        <div className="absolute top-12 left-1/2 -translate-x-1/2 px-4 py-1 border border-white/5 text-[8px] font-mono text-gray-700 uppercase tracking-[1em]">
          Classified Information Service
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#050505] text-gray-100 font-sans selection:bg-blue-500/30 overflow-hidden">
      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ 
          width: isSidebarOpen ? 280 : 0,
          opacity: isSidebarOpen ? 1 : 0 
        }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed lg:relative flex-none h-full bg-[#0a0a0a] border-r border-white/5 flex flex-col z-40 overflow-hidden"
      >
        <div className="flex-none p-4 flex items-center justify-between gap-2">
          <button 
            onClick={startNewChat}
            className="flex-1 flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/5 px-4 py-2.5 rounded-xl transition-all font-medium text-sm active:scale-95 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden p-2 hover:bg-white/5 rounded-lg text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1 py-2 custom-scrollbar">
          <p className="px-3 py-2 text-[10px] text-gray-600 font-bold uppercase tracking-widest">History</p>
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => {
                setActiveConvId(conv.id);
                if (window.innerWidth < 1024) setIsSidebarOpen(false);
              }}
              className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all border ${
                activeConvId === conv.id 
                  ? 'bg-blue-600/10 border-blue-500/20 text-blue-100' 
                  : 'bg-transparent border-transparent hover:bg-white/5 text-gray-400'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <MessageSquare className="w-3.5 h-3.5 flex-none" />
                <span className="truncate text-xs font-medium">{conv.title}</span>
              </div>
              <button 
                onClick={(e) => deleteConversation(e, conv.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:text-red-500 transition-all rounded-md hover:bg-red-500/10"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex-none p-4 border-t border-white/5 flex items-center justify-between bg-black/20">
          <div className="flex items-center gap-3 overflow-hidden">
            {user.photoURL ? (
              <img src={user.photoURL} className="w-8 h-8 rounded-full border border-white/10" alt="avatar" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold ring-1 ring-white/20">
                {user.displayName?.[0] || 'U'}
              </div>
            )}
            <div className="overflow-hidden">
              <p className="text-xs font-bold truncate leading-none text-white/90">{user.displayName || 'Agent'}</p>
              <p className="text-[9px] text-gray-500 truncate mt-1 font-mono uppercase tracking-widest">Active Link</p>
            </div>
          </div>
          <button 
            onClick={handleSignOut}
            className="p-2 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative h-full z-10">
        {/* Header */}
        <header className="flex-none bg-[#050505]/80 backdrop-blur-xl border-b border-white/5 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-white/5 rounded-lg text-gray-400 transition-all"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-tight">BLACKBOX <span className="text-blue-500">SENTINEL</span></h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-500">Secure Node</span>
              </div>
          </div>
        </header>

        {/* Chat Area */}
        <main className="flex-1 overflow-y-auto px-4 py-8 custom-scrollbar">
          <div className="max-w-3xl mx-auto space-y-8">
            <AnimatePresence initial={false}>
              {messages.length === 0 && !isLoading && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center justify-center py-24 text-center space-y-8"
                >
                  <div className="flex flex-col items-center gap-6">
                    <BlackBoxLogo className="w-24 h-24 shadow-[0_0_60px_-15px_rgba(37,99,235,0.3)] ring-1 ring-white/10" />
                    <div className="space-y-1">
                      <p className="text-[10px] text-blue-500/80 font-black uppercase tracking-[0.6em]">Neural Interface active</p>
                      <p className="text-[9px] text-gray-600 font-mono uppercase tracking-[0.4em]">Black Box Group of Companies</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h2 className="text-3xl font-black text-white/90 italic tracking-tighter uppercase">We are live now.</h2>
                    <p className="text-gray-500 max-w-sm mx-auto text-sm leading-relaxed font-medium">
                      Standing by for data input or secure voice transmission. All transmissions are quantum-encrypted.
                    </p>
                  </div>
                </motion.div>
              )}
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex gap-4 max-w-[90%] md:max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`flex-none w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${
                      msg.role === 'user' ? 'bg-blue-600 animate-pulse' : 'bg-gray-800 border border-white/10'
                    }`}>
                      {msg.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-blue-400" />}
                    </div>
                    <div className={`relative px-4 py-3 rounded-xl ${
                      msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-none shadow-xl shadow-blue-900/10' 
                        : 'bg-[#0f0f0f] border border-white/5 text-gray-200 rounded-tl-none shadow-2xl'
                    }`}>
                      {msg.fileName && (
                        <div className="mb-2 p-1.5 bg-white/5 rounded-lg border border-white/10 flex items-center gap-2 text-[9px] text-gray-300 font-mono uppercase tracking-wider">
                          {msg.fileType?.startsWith('image/') ? <ImageIcon className="w-2.5 h-2.5" /> : <FileText className="w-2.5 h-2.5" />}
                          <span className="truncate">{msg.fileName}</span>
                        </div>
                      )}
                      <div className={`prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 text-[13px] ${
                        msg.role === 'user' ? 'prose-p:text-white' : ''
                      }`}>
                        <Markdown>{msg.content}</Markdown>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-4">
                        <span className={`text-[8px] uppercase tracking-[0.2em] font-mono ${msg.role === 'user' ? 'text-white/40' : 'text-gray-600'}`}>
                          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div className="flex gap-4 items-center bg-[#0f0f0f] border border-white/5 px-5 py-4 rounded-2xl rounded-tl-none shadow-2xl">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></span>
                  </div>
                  <span className="text-xs text-blue-500/80 font-mono tracking-widest uppercase">Processing</span>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Footer Area */}
        <footer className="flex-none p-4 pb-8 bg-gradient-to-t from-[#050505] to-transparent">
          <div className="max-w-3xl mx-auto space-y-4">
            {attachment && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="mb-4 p-3 bg-[#0a0a0a] border border-white/10 rounded-xl flex items-center justify-between group/preview shadow-2xl"
              >
                <div className="flex items-center gap-4">
                  <div className="relative w-12 h-12 flex-none bg-white/5 rounded-lg border border-white/10 overflow-hidden flex items-center justify-center">
                    {attachment.type.startsWith('image/') && attachmentPreview ? (
                      <img 
                        src={attachmentPreview} 
                        alt="Preview" 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <FileText className="w-6 h-6 text-blue-500" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate max-w-[240px]">{attachment.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest">Ready for upload</span>
                      <span className="w-1 h-1 rounded-full bg-gray-700" />
                      <span className="text-[9px] font-mono text-blue-400 uppercase tracking-widest">{(attachment.size / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setAttachment(null)}
                  className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                  title="Discard attachment"
                >
                  <X className="w-5 h-5" />
                </button>
              </motion.div>
            )}

            <div className="relative group flex flex-col">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
                accept="image/*,.pdf,.txt,.js,.py,.ts,.json,.md"
              />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Inquire with Sentinel..."
                disabled={isLoading}
                rows={1}
                className="w-full bg-[#0a0a0a] border border-white/10 text-white rounded-xl pl-11 pr-24 py-3.5 focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500/50 transition-all placeholder-gray-600 shadow-2xl group-hover:border-white/20 disabled:opacity-50 text-sm resize-none overflow-hidden min-h-[48px]"
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = `${target.scrollHeight}px`;
                }}
              />
              <div className="absolute left-3 top-[10px]">
                <button
                  type="button"
                  onClick={handleFileClick}
                  disabled={isLoading}
                  className="p-1.5 text-gray-500 hover:text-blue-400 transition-colors rounded-lg hover:bg-white/5"
                  title="Attach asset"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
              </div>
              <div className="absolute right-1.5 bottom-1.5 flex gap-1.5">
                <button
                  onClick={toggleListening}
                  disabled={isLoading}
                  className={`px-3 py-2 rounded-lg transition-all flex items-center justify-center active:scale-95 shadow-lg border ${
                    isListening 
                      ? 'bg-red-500/10 border-red-500/50 text-red-500 animate-pulse' 
                      : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                  title={isListening ? "Stop listening" : "Start voice input"}
                >
                  {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={handleSend}
                  disabled={(!input.trim() && !attachment) || isLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-white/5 disabled:text-gray-700 text-white rounded-lg transition-all flex items-center justify-center active:scale-95 shadow-lg group-focus-within:ring-2 ring-blue-500/50"
                  title="Send message"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between px-2">
               <p className="text-[9px] text-gray-800 uppercase font-mono tracking-[0.4em]">Blackbox Group of Companies</p>
               <p className="text-[9px] text-gray-800 uppercase font-mono tracking-[0.4em] hidden sm:block">Session Verified</p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}


