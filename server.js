const WebSocket = require('ws');
const express = require('express');
const os = require('os');
const app = express();

// Phục vụ các file trong thư mục public
app.use(express.static('public'));

// Lấy địa chỉ IP của máy
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const PORT = 3000;
const localIP = getLocalIP();

// Lắng nghe trên cổng 3000
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 =======================================');
    console.log('🚤 BOAT CONTROL SERVER ĐANG CHẠY!');
    console.log('========================================');
    console.log(`💻 Truy cập trên máy tính: http://localhost:${PORT}`);
    console.log(`📱 Truy cập trên thiết bị khác: http://${localIP}:${PORT}`);
    console.log(`🔧 WebSocket URL cho ESP32: ws://${localIP}:${PORT}`);
    console.log('========================================\n');
});

// Xử lý lỗi server
server.on('error', (error) => {
    console.error('❌ Server Error:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`⚠️ Port ${PORT} đang được sử dụng. Vui lòng đóng ứng dụng khác hoặc thay đổi port.`);
        process.exit(1);
    }
});

const wss = new WebSocket.Server({ server });

// Đếm số kết nối
let connectionCount = 0;
const clients = new Map();

wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    const clientId = ++connectionCount;
    
    clients.set(clientId, { ws, ip: clientIP, connectedAt: new Date() });
    
    console.log(`✅ [${clientId}] Thiết bị kết nối từ ${clientIP}`);
    console.log(`📊 Tổng số kết nối hiện tại: ${clients.size}`);

    // Gửi tin nhắn chào mừng
    try {
        ws.send(JSON.stringify({ 
            type: 'welcome', 
            message: 'Connected to Boat Control Server',
            clientId: clientId 
        }));
    } catch (error) {
        console.error(`❌ [${clientId}] Error sending welcome message:`, error.message);
    }

    // Xử lý tin nhắn từ client
    ws.on('message', (message) => {
        try {
            // Validate JSON
            const messageStr = message.toString();
            const data = JSON.parse(messageStr);
            
            // Kiểm tra cấu trúc dữ liệu điều khiển
            if (typeof data === 'object' && 
                ('lx' in data || 'l2' in data || 'r2' in data)) {
                
                // Log chi tiết (có thể tắt để giảm spam)
                // console.log(`📡 [${clientId}] Control data:`, data);
                
                // Chuyển tiếp tới tất cả client khác
                let forwardCount = 0;
                wss.clients.forEach((client) => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        try {
                            client.send(messageStr);
                            forwardCount++;
                        } catch (error) {
                            console.error('❌ Error forwarding message:', error.message);
                        }
                    }
                });
                
                // Log mỗi 100 tin nhắn để không spam console
                if (connectionCount % 100 === 0) {
                    console.log(`📤 Forwarded to ${forwardCount} client(s)`);
                }
            } else {
                console.warn(`⚠️ [${clientId}] Invalid control data structure:`, data);
            }
            
        } catch (error) {
            console.error(`❌ [${clientId}] Error processing message:`, error.message);
            // Không ngắt kết nối, chỉ log lỗi
        }
    });

    // Xử lý lỗi
    ws.on('error', (error) => {
        console.error(`❌ [${clientId}] WebSocket error:`, error.message);
    });

    // Xử lý ngắt kết nối
    ws.on('close', (code, reason) => {
        clients.delete(clientId);
        console.log(`❌ [${clientId}] Thiết bị ngắt kết nối (Code: ${code})`);
        if (reason) {
            console.log(`   Lý do: ${reason}`);
        }
        console.log(`📊 Tổng số kết nối hiện tại: ${clients.size}`);
    });

    // Heartbeat để phát hiện kết nối chết
    const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.ping();
            } catch (error) {
                console.error(`❌ [${clientId}] Ping error:`, error.message);
                clearInterval(heartbeat);
            }
        } else {
            clearInterval(heartbeat);
        }
    }, 30000); // Ping mỗi 30 giây

    ws.on('pong', () => {
        // Connection still alive
    });
});

// Xử lý lỗi WebSocket server
wss.on('error', (error) => {
    console.error('❌ WebSocket Server Error:', error);
});

// Log định kỳ số lượng kết nối
setInterval(() => {
    if (clients.size > 0) {
        console.log(`📊 Status: ${clients.size} active connection(s)`);
    }
}, 60000); // Mỗi 60 giây

// Xử lý tín hiệu tắt server
process.on('SIGINT', () => {
    console.log('\n⚠️ Đang tắt server...');
    
    // Đóng tất cả kết nối
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.close(1000, 'Server shutting down');
        }
    });
    
    wss.close(() => {
        console.log('✅ WebSocket server đã đóng');
        server.close(() => {
            console.log('✅ HTTP server đã đóng');
            process.exit(0);
        });
    });
    
    // Force exit sau 5 giây nếu không tắt được
    setTimeout(() => {
        console.error('❌ Không thể tắt server gracefully, forcing exit...');
        process.exit(1);
    }, 5000);
});

console.log('✅ Server initialization complete. Waiting for connections...\n');
