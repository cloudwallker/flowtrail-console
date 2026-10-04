import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './lib/api';
import App from './App';
import './styles.css';
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 1500, retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1, refetchOnWindowFocus: true }, mutations: { retry: false } } });
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><App /></BrowserRouter></QueryClientProvider></React.StrictMode>);
