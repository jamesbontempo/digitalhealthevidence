const express = require("express");
const parser = require('body-parser');
const favicon = require('serve-favicon')
const fs = require("fs");
const path = require("path")
const https = require("https");

const baseQuery = "\"digital health\"[Text Word] OR eHealth OR mhealth";

const eutils = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const esearch = "esearch.fcgi?api_key=5a8c154e76a6cf874fac7ac38b5abe462e09&db=pubmed&usehistory=y";
const esummary = "efetch.fcgi?api_key=5a8c154e76a6cf874fac7ac38b5abe462e09&db=pubmed&retmax=10&rettype=xml";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fetch = async (url) => {
    return new Promise((resolve, reject) => {
        const request = https.get(new URL(url), (response) => {
            var data = "";
            response.on("data", (chunk) => {
                data += chunk;
            });
            response.on("end", () => {
                resolve(data);
            });
        });
        request.on("error", (err) => {
            reject(err);
        });
    });
};

const processSearch = (data) => {
    const result = data.split("\n").join("");
    var count = ((count = result.match(/<Count>(.+?)<\/Count>/))) ? count[1] : 0;
    var queryKey = ((queryKey = result.match(/<QueryKey>(.+?)<\/QueryKey>/))) ? queryKey[1] : "";
    var webEnv = ((webEnv = result.match(/<WebEnv>(.+?)<\/WebEnv>/))) ? webEnv[1] : "";
    return [count, queryKey, webEnv];
}

const processSummary = (data) => {
    var summaries = [];
    const articles = data.split("\n").join("").matchAll(/(<PubmedArticle>.+?<\/PubmedArticle>)/g);
    for (const article of articles) {
        var title = ((title = article[0].match(/<ArticleTitle>(.+?)<\/ArticleTitle>/))) ? title[1] : "";
        var authors = ((authors = Array.from(article[0].matchAll(/<LastName>(.+?)<\/LastName>.*?<Initials>(.+?)<\/Initials>/g)))) ? authors.map(n => n[1] + ", " + n[2]).join("; ") : "";
        var journal = ((journal = article[0].match(/<Title>(.+?)<\/Title>/))) ? journal[1] : "";
        var pubYear = ((pubYear = article[0].match(/<PubDate>.*?<Year>(.+?)<\/Year>.*?<\/PubDate>/))) ? pubYear[1] : "";
        var pubMonth = ((pubMonth = article[0].match(/<PubDate>.*?<Month>(.+?)<\/Month>.*?<\/PubDate>/))) ? pubMonth[1] : "";
        var pubDay = ((pubDay = article[0].match(/<PubDate>.*?<Day>(.+?)<\/Day>.*?<\/PubDate>/))) ? parseFloat(pubDay[1]) : "";
        const pubDate = ((pubDay !== "") ? pubDay + " " : "") + ((pubMonth !== "") ? ((!Number.isNaN(parseFloat(pubMonth))) ? months[parseFloat(pubMonth)-1] : pubMonth) + " " : "") + ((pubYear) ? pubYear : "");

        var pubMedYear = ((pubMedYear = article[0].match(/PubMedPubDate PubStatus="pubmed">.*?<Year>(.+?)<\/Year>.*?<\/PubMedPubDate>/))) ? pubMedYear[1] : "";
        var pubMedMonth = ((pubMedMonth = article[0].match(/PubMedPubDate PubStatus="pubmed">.*?<Month>(.+?)<\/Month>.*?<\/PubMedPubDate>/))) ? pubMedMonth[1] : "";
        var pubMedDay = ((pubMedDay = article[0].match(/PubMedPubDate PubStatus="pubmed">.*?<Day>(.+?)<\/Day>.*?<\/PubMedPubDate>/))) ? pubMedDay[1] : "";
        const pubMedDate = ((pubMedDay !== "") ? pubMedDay + " " : "") + ((pubMedMonth !== "") ? ((!Number.isNaN(parseFloat(pubMedMonth))) ? months[parseFloat(pubMedMonth)-1] : pubMedMonth) + " " : "") + ((pubMedYear) ? pubMedYear : "");

        var abstract = ((abstract = article[0].match(/(<AbstractText.*>.+<\/AbstractText>)/))) ? abstract[1].replace(/<AbstractText.*?>/g, "").replace(/<\/AbstractText>/g, " ") : "";
        var doi = ((doi = article[0].match(/<ArticleId IdType="doi">(.+?)<\/ArticleId>/))) ? doi[1] : "";
        summaries.push([{name: "Title", value: title}, {name: "Authors", value: authors}, {name: "Journal", value: journal}, {name: "Publication Date", value: pubDate}, {name: "Date Added to PubMed", value: pubMedDate}, {name: "Abstract", value: abstract}, {name: "Link", value: "http://doi.org/" + doi}]);
    }
    return summaries;
};

const getSort = (sort) => {
    switch(sort) {
        case "added":
            return "";
        case "published":
            return "pub date";
        case "relevant":
            return "relevance";
        default:
            return "unknown";
    }
};

const app = express();

app.use(parser.json());
app.use(parser.urlencoded({extended: false}));
app.use(favicon(path.join(__dirname, "static", "favicon.ico")));

app.set("views", "./views");
app.set("view engine", "pug");

app.get("/", async (req,res) => {
    const searchResults = await fetch("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?api_key=5a8c154e76a6cf874fac7ac38b5abe462e09&db=pubmed&term=" + baseQuery);
    var count = processSearch(searchResults)[0];
    count -= (count % 1000);

    const quickLinks = JSON.parse(fs.readFileSync("quicklinks.json", "utf8"));

    res.render("index", {count: count, quickLinks: quickLinks});
});

app.get("/static/:file", (req, res) => {
    res.sendFile(req.params.file, {root: path.join(__dirname, "static")});
});

app.get("/search/", async (req, res) => {
    const start = Date.now();

    if (req.query.query === undefined) {res.status(400).send("Bad request (missing query)"); return; }
    if (req.query.sort === undefined) {res.status(400).send("Bad request (missing sort)"); return; }

    const query = req.query.query;
    const sort = getSort(req.query.sort);

    if (sort === "unknown") {res.status(400).send("Bad request (unkown sort)"); return; }

    const retstart = (req.query.start && Number.isInteger(parseFloat(req.query.start, 10))) ? parseFloat(req.query.start, 10) : 0;
    var count, queryKey, webEnv, summaries;

    const searchResults = await fetch(eutils + esearch + "&sort=" + sort + "&term=" + baseQuery + ((query && query !== "") ? " AND (" + query + ")" : ""));
    [count, queryKey, webEnv] = processSearch(searchResults);

    var next, window;

    if (query || query === "") {
        if (retstart < (count - 10)) {
             next = "/search/?query=" + query + "&start=" + (retstart + 10) + "&sort=" + req.query.sort;
             window = [retstart + 1, retstart + 10];
         } else {
             next = null;
             window = [retstart + 1, count];
        }

        const summaryResults = await fetch(eutils + esummary + "&query_key=" + queryKey + "&WebEnv=" + webEnv + "&retstart=" + retstart);
        summaries = processSummary(summaryResults);
    } else {
        next = null;
        window = [];
        summaries = [];
    }

    const quickLinks = JSON.parse(fs.readFileSync("quicklinks.json", "utf8"));

    res.render("search", {query: query, sort: (req.query.sort) ? req.query.sort : "relevant", results: summaries, window: window, count: count, time: (Date.now() - start)/1000, next: next, quickLinks: quickLinks});
});

const server = app.listen(3100, () => {
    const now = new Date();
    console.log(now.toUTCString() + " - Digital Health Evidence listening on port 3100 (PID: " + process.pid + ")");
});

process.on("SIGTERM", () => {
    const now = new Date();
    server.close( () => { console.log (now.toUTCString() + " - Digital Health Evidence terminated"); } );
});
