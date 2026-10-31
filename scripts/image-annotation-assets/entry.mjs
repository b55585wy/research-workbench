export { default as OpenSeadragon } from 'openseadragon';
export { createOSDAnnotator, UserSelectAction, ShapeType } from '@annotorious/openseadragon';
import '@annotorious/openseadragon/annotorious-openseadragon.css';
import { ShaderSystem } from '@pixi/core';
import { install } from '@pixi/unsafe-eval';
install({ ShaderSystem });
