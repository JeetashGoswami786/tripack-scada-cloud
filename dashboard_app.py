import asyncio
from fastapi import FastAPI, Request, Form, status, Body
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
import uvicorn

app = FastAPI(title="Tri-Pack Industrial SCADA")

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- GLOBAL MEMORY & AUTH ---
LIVE_DATA = {}
is_logged_in = False  

SCADA_USER = "admin"
SCADA_PASS = "tripack123"

# --- WEB ROUTES ---

@app.get("/")
async def serve_dashboard(request: Request):
    global is_logged_in
    if not is_logged_in:
        return RedirectResponse(url="/login", status_code=status.HTTP_303_SEE_OTHER)
    return templates.TemplateResponse(request=request, name="index.html")

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse(request=request, name="login.html", context={"error": None})

@app.post("/login")
async def login_submit(request: Request, username: str = Form(...), password: str = Form(...)):
    global is_logged_in
    if username == SCADA_USER and password == SCADA_PASS:
        is_logged_in = True
        return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
    
    return templates.TemplateResponse(
        request=request, 
        name="login.html", 
        context={"error": "Unauthorized Access. Invalid Credentials."}
    )

@app.get("/logout")
async def logout():
    global is_logged_in
    is_logged_in = False
    return RedirectResponse(url="/login", status_code=status.HTTP_303_SEE_OTHER)

@app.get("/api/live_data")
async def serve_api_data():
    return LIVE_DATA

# --- NEW CLOUD RECEIVER ENDPOINT ---
@app.post("/api/update_data")
async def update_live_data(data: dict = Body(...)):
    global LIVE_DATA
    # Accepts incoming data packets from your edge computer and updates the dashboard memory
    LIVE_DATA = data
    return {"status": "success", "message": "Cloud SCADA memory updated"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
