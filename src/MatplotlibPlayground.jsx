import React, { useEffect, useRef, useState } from "react";

export default function MatplotlibPlayground() {
    const [pyodide, setPyodide] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [code, setCode] = useState(DEFAULT_PY_CODE);
    const [imageSrc, setImageSrc] = useState(null);
    const [files, setFiles] = useState([]); // {name, content}
    const [virtualFiles, setVirtualFiles] = useState([]); // /data contents
    const pyRef = useRef(null);
    const outputRef = useRef(null);

    // Load Pyodide
    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            const src = "https://cdn.jsdelivr.net/pyodide/v0.23.3/full/pyodide.js";
            if (!window.loadPyodide) {
                await new Promise((resolve, reject) => {
                    const s = document.createElement("script");
                    s.src = src;
                    s.onload = resolve;
                    s.onerror = reject;
                    document.head.appendChild(s);
                });
            }
            try {
                const py = await window.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.23.3/full/" });
                await py.loadPackage(["numpy", "pandas", "matplotlib"]);
                if (!cancelled) {
                    setPyodide(py);
                    pyRef.current = py;
                    setLoading(false);
                }
            } catch (err) {
                console.error("Failed to load Pyodide:", err);
                alert("Failed to load Pyodide. Check console for details.");
                setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    async function syncFilesToPy() {
        if (!pyRef.current) return;
        const py = pyRef.current;
        try {
            await py.runPythonAsync(`
import os, shutil
if os.path.exists('/data'):
    shutil.rmtree('/data')
os.makedirs('/data')
`);
        } catch { }

        for (const f of files) {
            const bytes = new TextEncoder().encode(f.content);
            py.FS.writeFile(`/data/${f.name}`, bytes);
        }

        await py.runPythonAsync(`
from pyodide import to_js
import pandas as pd, io, os

def list_uploaded_files():
    if not os.path.exists('/data'):
        return []
    return os.listdir('/data')

def load_csv(name):
    path = f'/data/{name}'
    if not os.path.exists(path):
        raise FileNotFoundError(name)
    with open(path, 'rb') as f:
        raw = f.read()
    return pd.read_csv(io.BytesIO(raw))
`);

        await refreshVirtualFiles();
    }

    useEffect(() => {
        if (pyRef.current) syncFilesToPy();
    }, [files]);

    async function refreshVirtualFiles() {
        if (!pyRef.current) return;
        try {
            const py = pyRef.current;
            const fileList = await py.runPythonAsync("list_uploaded_files()");
            setVirtualFiles(fileList.toJs ? fileList.toJs() : []);
        } catch (err) {
            console.warn("Could not refresh /data files", err);
        }
    }

    async function runCode() {
        if (!pyRef.current) return;
        setBusy(true);
        setImageSrc(null);
        const py = pyRef.current;

        const runner = `
import sys, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np, pandas as pd
try:
${indent_code(code, 4)}
    try:
        fig = plt.gcf()
        fig.tight_layout()
        fig.savefig('/data/plot.png', dpi=150, bbox_inches='tight')
    except Exception as e:
        print('NO_FIGURE_OR_SAVE_ERROR:', e)
except Exception as e:
    import traceback
    traceback.print_exc()
    raise
`;

        try {
            await py.runPythonAsync(`import os
if not os.path.exists('/data'):
    os.makedirs('/data')`);

            await py.runPythonAsync(runner);

            if (py.FS.analyzePath('/data/plot.png').exists) {
                const data = py.FS.readFile('/data/plot.png');
                const blob = new Blob([data], { type: 'image/png' });
                const url = URL.createObjectURL(blob);
                setImageSrc(url);
            } else {
                setImageSrc(null);
                alert('No plot image was produced.');
            }
            await refreshVirtualFiles();
        } catch (err) {
            console.error('Error running Python code:', err);
            alert('Error while running code: ' + (err && err.toString()));
        } finally {
            setBusy(false);
        }
    }

    function handleFileUpload(e) {
        const chosen = Array.from(e.target.files);
        const newFiles = [];
        chosen.forEach((f) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const text = ev.target.result;
                newFiles.push({ name: f.name, content: text });
                if (newFiles.length === chosen.length) {
                    setFiles((prev) => [...prev.filter(p => !chosen.find(c => c.name === p.name)), ...newFiles]);
                }
            };
            reader.readAsText(f);
        });
    }

    function removeFile(name) {
        setFiles((prev) => prev.filter((f) => f.name !== name));
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4">
            <div className="max-w-7xl mx-auto">
                <header className="flex items-center justify-between mb-4">
                    <h1 className="text-2xl font-semibold">Matplotlib Playground (Pyodide)</h1>
                    <div className="text-sm text-gray-600">Runs Python & Matplotlib in your browser</div>
                </header>

                <div className="grid grid-cols-12 gap-4">
                    <aside className="col-span-3 bg-white p-3 rounded-lg shadow-sm">
                        <div className="mb-3">
                            <label className="block text-sm font-medium mb-1">Upload CSV files</label>
                            <input type="file" accept=".csv" multiple onChange={handleFileUpload} />
                        </div>
                        <div className="mb-3">
                            <div className="text-sm font-medium">Uploaded files</div>
                            <ul className="mt-2 text-sm">
                                {files.length === 0 && <li className="text-gray-500">(none)</li>}
                                {files.map((f) => (
                                    <li key={f.name} className="flex justify-between items-center py-1">
                                        <span className="truncate">{f.name}</span>
                                        <button className="ml-2 text-xs text-red-600" onClick={() => removeFile(f.name)}>remove</button>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="mb-3">
                            <div className="text-sm font-medium">Virtual /data files</div>
                            <ul className="mt-2 text-sm">
                                {virtualFiles.length === 0 && <li className="text-gray-500">(none)</li>}
                                {virtualFiles.map((f) => (
                                    <li key={f}>{f}</li>
                                ))}
                            </ul>
                            <button
                                className="mt-2 text-xs px-2 py-1 bg-gray-200 rounded"
                                onClick={refreshVirtualFiles}
                                disabled={loading || busy}
                            >Refresh</button>
                        </div>

                        <div className="mt-4">
                            <button
                                className="w-full px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
                                onClick={runCode}
                                disabled={loading || busy}
                            >
                                {loading ? 'Loading Pyodide...' : busy ? 'Running...' : 'Run Code'}
                            </button>
                        </div>

                        <div className="mt-4 text-xs text-gray-600">
                            <strong>Helpers available in Python:</strong>
                            <ul className="list-disc ml-4">
                                <li><code>pd</code> (pandas)</li>
                                <li><code>np</code> (numpy)</li>
                                <li><code>plt</code> (matplotlib.pyplot)</li>
                                <li><code>load_csv(filename)</code> — load uploaded CSV into a DataFrame</li>
                                <li>Files are stored in virtual <code>/data</code></li>
                            </ul>
                        </div>
                    </aside>

                    <main className="col-span-6 bg-white p-3 rounded-lg shadow-sm flex flex-col items-center justify-center">
                        <div className="w-full h-full flex flex-col items-center">
                            <div className="w-full text-center text-sm text-gray-500 mb-2">Visualization</div>
                            <div ref={outputRef} className="w-full h-96 bg-gray-100 rounded flex items-center justify-center overflow-hidden">
                                {imageSrc ? (
                                    <img src={imageSrc} alt="plot" className="max-h-full max-w-full" />
                                ) : (
                                    <div className="text-gray-400 text-sm">No plot yet. Run your code to generate a Matplotlib figure.</div>
                                )}
                            </div>
                        </div>
                    </main>

                    <section className="col-span-3 bg-white p-3 rounded-lg shadow-sm flex flex-col">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-medium">Code editor</div>
                            <div className="text-xs text-gray-500">Python / Matplotlib</div>
                        </div>
                        <textarea
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            className="flex-1 w-full p-2 border rounded font-mono text-sm h-96 resize-none"
                        />
                        <div className="mt-2 text-xs text-gray-500">Tip: use <code>load_csv('your.csv')</code> to access uploaded files.</div>
                    </section>
                </div>

                <footer className="mt-4 text-xs text-gray-500">Note: files in /data are virtual (inside Pyodide) and cleared on refresh.</footer>
            </div>
        </div>
    );
}

const DEFAULT_PY_CODE = `# Example plotting code
import numpy as np
x = np.linspace(0, 10, 200)
y = np.sin(x)
plt.figure(figsize=(6,4))
plt.plot(x, y, label='sin(x)')
plt.scatter(x[::10], y[::10])
plt.title('Sine wave')
plt.xlabel('x')
plt.ylabel('sin(x)')
plt.legend()
plt.grid(True)
`;

function indent_code(s, n) {
    return s.split('\n').map(line => ' '.repeat(n) + line).join('\n');
}