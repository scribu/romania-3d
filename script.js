var renderer, scene, camera, raycaster, meshes = [];
var mouse = new THREE.Vector2(), INTERSECTED;

var counties = d3.map();

var RO_CENTER = [45.9442858, 25.0094303];
var MAX_EXTRUSION = 10;

var years = [], currentYear;

var numberFormatter = d3.format('0,000');

// function that maps population int to extrusion value
// requires the maximum possible population
var getExtrusion;

// function that maps population int to luminance
// requires the maximum possible population
var getLuminance;

function initThree() {
	raycaster = new THREE.Raycaster();

	renderer = new THREE.WebGLRenderer();
	renderer.setSize(window.innerWidth, window.innerHeight);
	jQuery('body').append(renderer.domElement);

	scene = new THREE.Scene();

	camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 10000);
	camera.position.set(5.758599954432616, 23.977288734105162, -14.469445776390728);
	camera.up.set(-0.24237172077834185, 0.8703680689284763, -0.4519019512644872);

	// restoreCameraOrientation(camera);
	// scene.add(camera);

	var pointLight = new THREE.PointLight(0xFFFFFF);
	pointLight.position.set(800, 800, 800);
	scene.add(pointLight);

	controls = new THREE.TrackballControls(camera, renderer.domElement);
	controls.minDistance = 10;
	controls.maxDistance = 50;

	animate();
}

function updateInfoBox() {
	raycaster.setFromCamera( mouse, camera );

	var intersects = raycaster.intersectObjects( scene.children );

	var html = '';

	if (intersects.length > 0) {
		var countyCode = intersects[0].object.userData.countyCode;
		if (countyCode) {
			var county = counties.get(countyCode);
			var population = county.get(currentYear); 
			html = county.get('name') + ': ' + numberFormatter(population);
		}
	}

	jQuery('#infobox').html(html);
}

function animate() {
	controls.update();
	renderer.render(scene, camera);
	updateInfoBox();

	requestAnimationFrame(animate);
}

function onDocumentMouseMove( event ) {
	mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
	mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
}

function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize(window.innerWidth, window.innerHeight);
}


function cameraIter(callback) {
	['position', 'up'].forEach(callback);
}

function saveCameraOrientation() {
	cameraIter(function (key) {
		sessionStorage.setItem('camera.' + key, JSON.stringify(camera[key].toArray()));
	});
}

function restoreCameraOrientation() {
	cameraIter(function (key) {
		var val = JSON.parse(sessionStorage.getItem('camera.' + key));
		if (val) {
			camera[key].fromArray(val);
		}
	});
}


function initGeometry(features) {
	var path = d3.geo.path().projection(d3.geo.mercator().center(RO_CENTER));

	features.forEach(function(feature) {
		var county = counties.get(feature.id);
		county.set('contour', transformSVGPath(path(feature)));
		county.set('name', feature.properties.name);
	});
}

function renderPopulation(year) {
	// remove curren meshes
	meshes.forEach(function(mesh) {
		scene.remove(mesh);
	});

	meshes = counties.entries().map(function(entry) {
		var countyCode = entry.key, county = entry.value;
		var population = county.get(year);
		var extrusion = getExtrusion(population);
		var luminance = getLuminance(population);
		var color = d3.hsl(105, 0.8, luminance).toString();

		var extrudeMaterial = new THREE.MeshLambertMaterial({color: color}); 
		var faceMaterial = new THREE.MeshBasicMaterial({color: color});

		var geometry = county.get('contour').extrude({
			amount: extrusion,
			bevelEnabled: false,
			extrudeMaterial: 0,
			material: 1
		});

		var mesh = new THREE.Mesh(geometry, new THREE.MeshFaceMaterial(
			[extrudeMaterial, faceMaterial]));

		mesh.userData.countyCode = countyCode;

		// rotate and position the elements nicely in the center
		mesh.rotateX(Math.PI/2);
		mesh.rotateZ(-1.60);
		mesh.translateX(-425);
		mesh.translateY(-183);
		mesh.translateZ(-extrusion);

		scene.add(mesh);

		return mesh;
	});
}

// concurrently load multiple data sources; the callback will be invoked when everything is loaded
function loadData(sources, callback) {
	var remaining = sources.length;
	var results = {}

	sources.forEach(function(source) {
		function handler(error, data) {
			if (error) throw error;

			results[source.key] = data;

			remaining--;

			if (!remaining) {
				callback(results);
			}
		}

		args = source.args.slice();
		args.push(handler);
		d3[source.type].apply(d3, args);
	});
}

var dataSources = [
	{type: 'json', args: ['data/romania-topo.json'], key: 'judete'},
	{type: 'json', args: ['data/judete-id.json'], key: 'id_judete'},
	{type: 'csv', args: ['data/recensaminte.csv'], key: 'recensaminte'}
];

function extractYears(recensaminte) {
	return Object.keys(recensaminte[0]).filter(function(key) {
		return key !== 'name';
	}).map(function(year) {
		return parseInt(year, 10);
	});
}

function prepareCensusData(recensaminte, id_judete) {
	var max_population = 0;
	var year_sums = {};

	recensaminte.forEach(function(row) {
		var countyCode = id_judete[row.name];

		var datum = d3.map();

		years.forEach(function(year) {
			var value = parseInt(row[year], 10);

			datum.set(year, value);

			if (value > max_population) {
				max_population = value;
			}
		});

		counties.set(countyCode, datum);
	});

	return max_population;
}

initThree();

loadData(dataSources, function(results) {
	years = extractYears(results.recensaminte);
	var max_population = prepareCensusData(results.recensaminte, results.id_judete);

	getExtrusion = d3.scale.linear().domain([0, max_population]).range([0, MAX_EXTRUSION]);
	getLuminance = d3.scale.linear().domain([0, max_population]);

	var judete = results.judete;

	var features = topojson.feature(judete, judete.objects['romania-counties-geojson']).features;
	initGeometry(features);

	var yearSelect = jQuery('#current-year');

	yearSelect.append(years.map(function(year) {
		return jQuery('<button type="button" class="btn btn-default">').html(year);
	}));

	yearSelect.on('click', 'button', function(ev) {
		var $this = jQuery(this);

		currentYear = parseInt($this.html(), 10);

		renderPopulation(currentYear);

		yearSelect.find('button').removeClass('active');
		$this.addClass('active');
	});

	yearSelect.find('button')[0].click();
});

jQuery(document).on('mousemove', onDocumentMouseMove);
jQuery(window).on('resize', onWindowResize);
jQuery(window).on('beforeunload', saveCameraOrientation);
