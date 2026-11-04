"""Static device entry: no tenant lookup, workspace allocation or file fallback."""
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles


class FrontendFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        # Native ES module imports keep stable URLs across releases. Revalidate
        # them so an updated entry cannot reuse an incompatible old dependency.
        response.headers['Cache-Control'] = 'no-cache'
        return response


def install_device_pages(app, frontend):
    @app.get('/device', include_in_schema=False)
    def device_redirect():
        return RedirectResponse('/device/', status_code=307)

    @app.get('/device/', include_in_schema=False)
    def device_page():
        content = (frontend / 'index.html').read_text(encoding='utf-8')
        content = content.replace('<html ', '<html data-storage-mode="device" ', 1)
        return HTMLResponse(content, headers={'Cache-Control': 'no-store'})

    @app.api_route('/device/files/{path:path}', methods=['GET', 'HEAD'], include_in_schema=False)
    def unavailable_device_file(path: str):
        # Only the scoped browser worker may resolve device data. Never serve a
        # same-named server file if that worker is unavailable.
        return Response(status_code=404, headers={'Cache-Control': 'no-store'})

    @app.get('/storage', include_in_schema=False)
    def storage_choice():
        return FileResponse(frontend / 'storage-choice.html', media_type='text/html',
                            headers={'Cache-Control': 'no-store'})


def choice_response(frontend):
    return FileResponse(frontend / 'storage-choice.html', media_type='text/html',
                        headers={'Cache-Control': 'no-store'})
