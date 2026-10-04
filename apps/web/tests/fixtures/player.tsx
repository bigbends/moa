import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WatchPage } from '../../src/pages/WatchPage';
import '../../src/styles/base.css';import '../../src/styles/components.css';import '../../src/styles/player.css';
function Test(){const navigate=useNavigate();(window as any).testNavigate=navigate;return <Routes><Route path="/watch/:episodeId" element={<WatchPage/>}/></Routes>}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/watch/e1']}><Test/></MemoryRouter></QueryClientProvider>);
