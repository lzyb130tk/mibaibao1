/**
 * Baibaoxiang App Logic
 * Uses Native IndexedDB for storage and Vanilla JS for UI
 */

const DB_NAME = 'BaibaoxiangDB';
const DB_VERSION = 1;
const STORE_NAME = 'passwords';

class IDBHelper {
    constructor() {
        this.db = null;
    }

    async open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error("Database error: " + event.target.errorCode);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const objectStore = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
                    objectStore.createIndex("platform", "platform", { unique: false });
                    objectStore.createIndex("group", "group", { unique: false });
                }
            };
        });
    }

    async add(item) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);
            item.createdAt = new Date().toISOString();
            const request = store.add(item);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async update(item) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);
            item.updatedAt = new Date().toISOString();
            const request = store.put(item); // PUT updates if key exists

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAll() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], "readonly");
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async delete(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], "readwrite");
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async get(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_NAME], "readonly");
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

// Global App State
const App = {
    db: new IDBHelper(),
    state: {
        currentView: 'view-passwords',
        passwords: [],
        longPressTimer: null,
        activeContextItem: null,
        imageMask: {
            files: [],
            blobs: [], // Processed blobs
            radiusPercentage: 22,
            isSquircle: true
        }
    },

    init: async () => {
        try {
            await App.db.open();
            App.bindEvents();
            App.bindToolEvents();
            App.renderPasswordList();
            App.updateStorageUsage();
            App.initCategoryFilters();
            App.bindToolClickDelegation();
        } catch (e) {
            console.error("App Init Failed:", e);
        }
    },

    initCategoryFilters: () => {
        const chips = document.querySelectorAll('.filter-chip');
        const cards = document.querySelectorAll('.function-card');

        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                // update active state
                chips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');

                const filter = chip.getAttribute('data-filter');

                cards.forEach(card => {
                    const category = card.getAttribute('data-category');
                    if (filter === 'all' || category === filter) {
                        card.style.display = 'flex';
                    } else {
                        card.style.display = 'none';
                    }
                });
            });
        });
    },

    bindToolClickDelegation: () => {
        const grid = document.querySelector('.waterfall-grid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                const card = e.target.closest('[data-tool]');
                if (card) {
                    const toolId = card.getAttribute('data-tool');
                    App.openTool(toolId);
                }
            });
        }
    },

    bindEvents: () => {
        // Navigation Handling
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetId = btn.getAttribute('data-target');
                if (targetId) App.switchView(targetId);

                // Active state managed in switchView now
            });
        });

        // Header Action: Add Password
        const headerBtn = document.getElementById('header-action-btn');
        headerBtn.addEventListener('click', () => {
            if (App.state.currentView === 'view-passwords') {
                App.openPasswordModal();
            }
        });

        // Header Back Button
        document.getElementById('header-back-btn').addEventListener('click', () => {
            App.switchView('view-functions');
        });

        // Modal Close
        document.getElementById('btn-close-modal').addEventListener('click', App.closeModal);
        document.getElementById('btn-cancel-modal').addEventListener('click', App.closeModal);

        // Password Form Submit (Add or Edit)
        document.getElementById('form-password').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const id = formData.get('id');

            const item = {
                platform: formData.get('platform'),
                account: formData.get('account'),
                password: formData.get('password'),
                group: formData.get('group'),
                remarks: formData.get('remarks')
            };

            if (id) {
                // Edit
                item.id = parseInt(id);
                // Preserve createdAt
                const old = await App.db.get(item.id);
                item.createdAt = old.createdAt;
                await App.db.update(item);
                App.showToast('修改成功');
            } else {
                // Add
                await App.db.add(item);
                App.showToast('添加成功');
            }

            App.closeModal();
            App.renderPasswordList();
        });

        // Password List: Copy & Long Press
        const list = document.getElementById('password-list');

        list.addEventListener('click', (e) => {
            const copyBtn = e.target.closest('.copy-btn');
            if (copyBtn) {
                const text = copyBtn.getAttribute('data-copy');
                App.copyToClipboard(text);
            }
        });

        // Long Press Logic (Delegated)
        let touchTimer;
        list.addEventListener('touchstart', (e) => {
            const card = e.target.closest('.password-item');
            if (card && !e.target.closest('.copy-btn')) {
                const id = parseInt(card.getAttribute('data-id'));
                touchTimer = setTimeout(() => {
                    App.state.activeContextItem = id;
                    App.showContextMenu(id);
                }, 600); // 600ms long press
            }
        }, { passive: true });

        list.addEventListener('touchend', () => clearTimeout(touchTimer));
        list.addEventListener('touchmove', () => clearTimeout(touchTimer));

        // Context Menu Actions
        document.getElementById('context-overlay').addEventListener('click', App.hideContextMenu);

        document.getElementById('ctx-edit').addEventListener('click', async () => {
            App.hideContextMenu();
            const id = App.state.activeContextItem;
            if (id) {
                const item = await App.db.get(id);
                App.openPasswordModal(item);
            }
        });

        document.getElementById('ctx-delete').addEventListener('click', () => {
            App.hideContextMenu();
            const id = App.state.activeContextItem;
            if (id) {
                if (confirm('确定要删除这条密码吗？')) {
                    App.db.delete(id).then(() => {
                        App.showToast('已删除');
                        App.renderPasswordList();
                    });
                }
            }
        });

        // Settings Actions
        document.getElementById('btn-backup').addEventListener('click', App.exportData);
        document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-input').click());
        document.getElementById('file-input').addEventListener('change', App.importData);
    },

    bindToolEvents: () => {
        // --- Image Mask Tool Events ---

        // Upload
        const uploadArea = document.getElementById('mask-upload-area');
        const fileInput = document.getElementById('mask-file-input');

        uploadArea.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                App.handleImages(Array.from(e.target.files));
            }
        });

        // Drag and Drop
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = '#007AFF'; });
        uploadArea.addEventListener('dragleave', (e) => { e.preventDefault(); uploadArea.style.borderColor = '#E5E5EA'; });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = '#E5E5EA';
            if (e.dataTransfer.files.length > 0) App.handleImages(Array.from(e.dataTransfer.files));
        });

        // Controls
        const radiusInput = document.getElementById('mask-radius');
        const squircleCheck = document.getElementById('mask-squircle');

        const updateParams = () => {
            App.state.imageMask.radiusPercentage = parseInt(radiusInput.value);
            App.state.imageMask.isSquircle = squircleCheck.checked;
            document.getElementById('radius-value').textContent = App.state.imageMask.radiusPercentage + '%';
            App.renderMaskPreviews();
        };

        radiusInput.addEventListener('input', updateParams);
        squircleCheck.addEventListener('change', updateParams);

        // Presets
        document.getElementById('btn-save-preset').addEventListener('click', () => {
            const preset = {
                radius: App.state.imageMask.radiusPercentage,
                squircle: App.state.imageMask.isSquircle
            };
            localStorage.setItem('mask_preset', JSON.stringify(preset));
            App.showToast('预设已保存');
        });

        document.getElementById('btn-apply-preset').addEventListener('click', () => {
            const saved = localStorage.getItem('mask_preset');
            if (saved) {
                const preset = JSON.parse(saved);
                radiusInput.value = preset.radius;
                squircleCheck.checked = preset.squircle;
                updateParams();
                App.showToast('预设已应用');
            } else {
                App.showToast('暂无预设');
            }
        });

        // Export Tool result
        document.getElementById('btn-export-mask').addEventListener('click', App.exportMaskedImages);
    },

    switchView: (viewId) => {
        // Toggle Styles
        document.querySelectorAll('.view').forEach(el => {
            el.classList.remove('active');
            el.classList.add('hidden');
        });

        // Hide/Show target
        const target = document.getElementById(viewId);
        target.classList.remove('hidden');
        setTimeout(() => target.classList.add('active'), 10);

        App.state.currentView = viewId;

        // Navigation Bar State
        const navBtn = document.querySelector(`.nav-item[data-target="${viewId}"]`);
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        if (navBtn) navBtn.classList.add('active');

        // Header Logic
        const headerTitle = document.getElementById('page-title');
        const headerActionBtn = document.getElementById('header-action-btn');
        const headerBackBtn = document.getElementById('header-back-btn');

        if (viewId === 'view-passwords') {
            headerTitle.textContent = '密码册';
            headerActionBtn.style.display = 'flex';
            headerBackBtn.classList.add('hidden');
            document.querySelector('.bottom-nav').style.display = 'flex';
        } else if (viewId === 'view-functions') {
            headerTitle.textContent = '功能库';
            headerActionBtn.style.display = 'none';
            headerBackBtn.classList.add('hidden');
            document.querySelector('.bottom-nav').style.display = 'flex';
        } else if (viewId.startsWith('tool-')) {
            // Tool View
            headerTitle.textContent = '图片圆角'; // Dynamic based on tool?
            headerActionBtn.style.display = 'none';
            headerBackBtn.classList.remove('hidden');
            document.querySelector('.bottom-nav').style.display = 'none'; // Hide nav in tool
        } else if (viewId === 'view-settings') {
            headerTitle.textContent = '设置';
            headerActionBtn.style.display = 'none';
            headerBackBtn.classList.add('hidden');
            document.querySelector('.bottom-nav').style.display = 'flex';
            App.updateStorageUsage();
        }
    },

    // --- Tool Logic: Image Mask ---
    openTool: (toolId) => {
        App.switchView(toolId);
    },

    handleImages: (files) => {
        // Filter images
        const images = files.filter(f => f.type.startsWith('image/'));
        if (images.length === 0) return;

        App.state.imageMask.files = images;
        // Reset processed blobs
        App.state.imageMask.blobs = [];

        App.renderMaskPreviews();

        // Show FAB
        const fab = document.getElementById('btn-export-mask');
        fab.classList.remove('hidden');
        setTimeout(() => fab.classList.add('visible'), 100);
    },

    renderMaskPreviews: () => {
        const grid = document.getElementById('mask-preview-grid');
        grid.innerHTML = '';
        App.state.imageMask.blobs = []; // clear previous

        App.state.imageMask.files.forEach((file, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'preview-item';
            const canvas = document.createElement('canvas');
            wrapper.appendChild(canvas);
            grid.appendChild(wrapper);

            const img = new Image();
            img.onload = () => {
                // Calculate size (Fit to 512x512 max for preview performance, or standard export size?)
                // Let's use 300px for preview, but keep aspect ratio 1:1 if we want ios icon style
                // If we want to mask arbitrary images, we keep aspect ratio canvas logic

                const size = 300; // Preview render size
                canvas.width = size;
                canvas.height = size;

                const ctx = canvas.getContext('2d');

                // Draw logic with masking
                // 1. Create path
                const r = (App.state.imageMask.radiusPercentage / 100) * (size / 2);

                ctx.beginPath();
                if (App.state.imageMask.isSquircle) {
                    // Apple-like superellipse approximation
                    // Path simplified: M 0,r Q 0,0 r,0 L w-r,0 Q w,0 w,r L w,h-r Q w,h w-r,h L r,h Q 0,h 0,h-r Z
                    // Actually, standard quadratic curves are good enough for squircle-ish look at this scale,
                    // or we use multiple bezier curves.
                    // Let's use standard roundRect for now, new browser API support is good.
                    if (ctx.roundRect) {
                        ctx.roundRect(0, 0, size, size, r);
                    } else {
                        // Fallback
                        ctx.rect(0, 0, size, size);
                    }
                } else {
                    // Standard rounded rect
                    if (ctx.roundRect) {
                        ctx.roundRect(0, 0, size, size, r);
                    } else {
                        // old school arc
                        ctx.moveTo(r, 0);
                        ctx.lineTo(size - r, 0);
                        ctx.quadraticCurveTo(size, 0, size, r);
                        ctx.lineTo(size, size - r);
                        ctx.quadraticCurveTo(size, size, size - r, size);
                        ctx.lineTo(r, size);
                        ctx.quadraticCurveTo(0, size, 0, size - r);
                        ctx.lineTo(0, r);
                        ctx.quadraticCurveTo(0, 0, r, 0);
                    }
                }
                ctx.closePath();
                ctx.clip();

                // 2. Draw Image (Cover mode)
                // Calculate scale to cover square
                let sWidth = img.width;
                let sHeight = img.height;
                let sx = 0, sy = 0;

                // Center crop
                if (sWidth > sHeight) {
                    sWidth = sHeight;
                    sx = (img.width - sHeight) / 2;
                } else {
                    sHeight = sWidth;
                    sy = (img.height - sWidth) / 2;
                }

                ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, size, size);

                // Store blob for export (async)
                canvas.toBlob(blob => {
                    App.state.imageMask.blobs[index] = blob;
                }, 'image/png');
            };
            img.src = URL.createObjectURL(file);
        });
    },

    exportMaskedImages: async () => {
        const blobs = App.state.imageMask.blobs;
        if (!blobs || blobs.length === 0) return;

        if (blobs.length === 1 && blobs[0]) {
            // Single download
            const url = URL.createObjectURL(blobs[0]);
            const a = document.createElement('a');
            a.href = url;
            a.download = `masked_icon_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } else {
            // Zip download
            const zip = new JSZip();
            blobs.forEach((blob, i) => {
                if (blob) zip.file(`icon_${i + 1}.png`, blob);
            });
            const content = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `icons_batch_${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
        App.showToast("导出完成");
    },

    // --- Context Menu Logic ---
    showContextMenu: (id) => {
        navigator.vibrate(50); // Haptic feedback
        const menu = document.getElementById('context-menu');
        const overlay = document.getElementById('context-overlay');

        overlay.classList.remove('hidden');
        menu.classList.remove('hidden');

        // Force reflow
        void menu.offsetWidth;

        overlay.classList.add('active');
        menu.classList.add('active');
    },

    hideContextMenu: () => {
        const menu = document.getElementById('context-menu');
        const overlay = document.getElementById('context-overlay');

        overlay.classList.remove('active');
        menu.classList.remove('active');

        setTimeout(() => {
            overlay.classList.add('hidden');
            menu.classList.add('hidden');
            App.state.activeContextItem = null;
        }, 300);
    },

    // ... (Existing Methods: renderPasswordList, showModal, closeModal, copyToClipboard, etc.)
    openPasswordModal: (item = null) => {
        const form = document.getElementById('form-password');
        const title = document.getElementById('modal-title');

        if (item) {
            title.textContent = '编辑密码项';
            document.getElementById('edit-id').value = item.id;
            document.getElementById('input-platform').value = item.platform;
            document.getElementById('input-account').value = item.account;
            document.getElementById('input-password').value = item.password;
            document.getElementById('input-group').value = item.group || '';
            document.getElementById('input-remarks').value = item.remarks || '';
        } else {
            title.textContent = '新建密码项';
            form.reset();
            document.getElementById('edit-id').value = '';
        }

        App.showModal('modal-password');
    },

    renderPasswordList: async () => {
        const listContainer = document.getElementById('password-list');
        // listContainer.innerHTML = '<div class="empty-state">加载中...</div>'; // Remove to prevent flash

        const items = await App.db.getAll();
        App.state.passwords = items;

        if (items.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <div class="ceramic-icon">
                         <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                    </div>
                    <p>暂无密码</p>
                    <p style="font-size:12px">点击右上角 + 添加</p>
                </div>`;
            return;
        }

        // Sort: Grouped? Or Just Newest? Newest for now.
        items.sort((a, b) => b.id - a.id);

        let html = '';
        items.forEach(item => {
            html += `
            <div class="ceramic-card password-item" data-id="${item.id}">
                <div class="password-info">
                    <div class="password-title">${App.escapeHtml(item.platform)}</div>
                    <div class="password-detail">${App.escapeHtml(item.account)}</div>
                    ${item.group ? `<span style="font-size:10px; background:#f0f0f0; padding:2px 6px; border-radius:4px; color:#666;">${App.escapeHtml(item.group)}</span>` : ''}
                </div>
                <div class="password-actions">
                     <button class="action-btn-small copy-btn" data-copy="${App.escapeHtml(item.account)}">账号</button>
                     <button class="action-btn-small copy-btn" data-copy="${App.escapeHtml(item.password)}">密码</button>
                </div>
            </div>
            `;
        });
        listContainer.innerHTML = html;
        App.updateStorageUsage();
    },

    showModal: (modalId) => {
        const modal = document.getElementById(modalId);
        modal.classList.remove('hidden');
        void modal.offsetWidth;
        modal.classList.add('active');
    },

    closeModal: () => {
        document.querySelectorAll('.modal-overlay').forEach(el => {
            el.classList.remove('active');
            setTimeout(() => el.classList.add('hidden'), 300);
        });
    },

    copyToClipboard: (text) => {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            App.showToast('已复制');
        }).catch(err => {
            // Fallback
            const textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("Copy");
            textArea.remove();
            App.showToast('已复制');
        });
    },

    showToast: (msg) => {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.remove('hidden');
        toast.style.opacity = 1;

        if (App.toastTimeout) clearTimeout(App.toastTimeout);
        App.toastTimeout = setTimeout(() => {
            toast.style.opacity = 0;
            setTimeout(() => toast.classList.add('hidden'), 200);
        }, 2000);
    },

    escapeHtml: (text) => {
        if (!text) return '';
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    },

    updateStorageUsage: async () => {
        const items = await App.db.getAll();
        const json = JSON.stringify(items);
        const bytes = new Blob([json]).size;

        let sizeStr = '';
        if (bytes < 1024) sizeStr = bytes + ' B';
        else if (bytes < 1024 * 1024) sizeStr = (bytes / 1024).toFixed(2) + ' KB';
        else sizeStr = (bytes / (1024 * 1024)).toFixed(2) + ' MB';

        const el = document.getElementById('storage-usage');
        if (el) el.textContent = sizeStr;
    },

    exportData: async () => {
        try {
            const items = await App.db.getAll();
            const zip = new JSZip();
            const metadata = { version: 1, exportedAt: new Date().toISOString(), count: items.length, app: "Baibaoxiang" };
            zip.file("metadata.json", JSON.stringify(metadata, null, 2));
            zip.file("passwords.json", JSON.stringify(items, null, 2));
            const blob = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `baibaoxiang_backup_${new Date().toISOString().slice(0, 10)}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            App.showToast('备份已导出');
        } catch (e) { console.error(e); App.showToast('导出失败'); }
    },

    importData: async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            const zip = new JSZip();
            const contents = await zip.loadAsync(file);
            if (!contents.files["passwords.json"]) throw new Error("Invalid backup file");
            const dataStr = await contents.files["passwords.json"].async("text");
            const data = JSON.parse(dataStr);
            if (!Array.isArray(data)) throw new Error("Invalid data format");
            let count = 0;
            for (const item of data) {
                const { id, ...cleanItem } = item;
                await App.db.add(cleanItem);
                count++;
            }
            App.showToast(`成功导入 ${count} 条数据`);
            App.renderPasswordList();
        } catch (e) {
            console.error(e);
            App.showToast('导入失败: 文件格式错误');
        }
        event.target.value = '';
    }
};

document.addEventListener('DOMContentLoaded', App.init);
