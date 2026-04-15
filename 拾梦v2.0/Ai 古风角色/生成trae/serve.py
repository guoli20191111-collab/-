import os, http.server, socketserver

os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = 8080
Handler = http.server.SimpleHTTPRequestHandler
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"服务器已启动！请用浏览器打开: http://localhost:{PORT}/index.html")
    print("按 Ctrl+C 停止服务器")
    httpd.serve_forever()
